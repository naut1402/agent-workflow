<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { slugify } from '../../../core/lib/stringUtils'
import {
  fetchCredentials,
  saveCredential,
  fetchOAuthCapabilities,
  startOAuthConnect,
  exchangeOAuthCode,
  fetchOAuthStatus,
  fetchAvailableModels,
} from '../scripts/ConnectionDialogApi'
import { saveProviderConfig, deleteProviderConfig } from '../scripts/ProviderDialogApi'
import { DEFAULT_BASE_URLS, DEFAULT_SECRET_ENV_HINTS } from '../scripts/agenticProviderDefaults'
import type { ProviderConfigOption, ProviderEntry } from '../types'
import InfoTooltip from '../../../core/ui/InfoTooltip.vue'

interface CredentialProfile {
  id: string
  provider: string
  label: string
  secretRef: string
}

const props = defineProps<{
  providers: ProviderEntry[]
  /** When set — edit existing provider config (id preserved). */
  providerConfig?: ProviderConfigOption | null
}>()

const emit = defineEmits<{
  close: []
  saved: [providerConfigId: string]
}>()

const { t } = useI18nHelpers()

const isEdit = computed(() => Boolean(props.providerConfig?.id))

const label = ref('')
const providerId = ref('')
const credentialId = ref('')
const baseURL = ref('')
const saving = ref(false)
const error = ref('')
const credentials = ref<CredentialProfile[]>([])
const showNewCredential = ref(false)
/** `id` intentionally not user-facing anymore — upsertCredential mints one when omitted. */
const newCred = ref({ label: '', secretValue: '', secretRef: '' })
const baseUrlPlaceholder = computed(() => DEFAULT_BASE_URLS[providerId.value] || '')
/** Hint only — must stay a placeholder, not a prefilled value, or "field left untouched" becomes indistinguishable from "field filled with the hint". */
const secretRefPlaceholder = computed(() => DEFAULT_SECRET_ENV_HINTS[providerId.value] || 'env:ANTHROPIC_API_KEY')

const aiProviders = computed(() => props.providers.filter((p) => p.kind === 'ai-provider'))

const filteredCredentials = computed(() =>
  credentials.value.filter((c) => !providerId.value || c.provider === providerId.value),
)

const oauthCapableProviders = ref<string[]>([])
/**
 * Whether the server can encrypt/store a secret at all (`DASHBOARD_SECRET_KEY`
 * set) — `true` until we actually hear otherwise, so the warning below never
 * flashes on for the split second before `loadOAuthCapabilities()` resolves.
 */
const vaultConfigured = ref(true)
/** OAuth tokens land in the same vault as pasted secrets — no vault key, no OAuth either. */
const canConnectOAuth = computed(() => vaultConfigured.value && oauthCapableProviders.value.includes(providerId.value))
type OAuthFlowStatus = 'idle' | 'starting' | 'pending' | 'exchanging' | 'error'
const oauthFlow = ref<{ state: string; status: OAuthFlowStatus; authorizeUrl: string; error: string }>({
  state: '',
  status: 'idle',
  authorizeUrl: '',
  error: '',
})
const oauthPasteInput = ref('')
let oauthPollTimer: ReturnType<typeof setInterval> | null = null

// Model loading doubles as a "does this provider config actually work" test.
const loadingModels = ref(false)
const modelTestResult = ref<string[]>([])
const modelTestError = ref('')
/** A key to fetch models with — an existing credential, or a not-yet-saved secret typed in "+ Credential". */
const canFetchModels = computed(() => Boolean(providerId.value && (credentialId.value || newCred.value.secretValue.trim())))

watch(providerId, () => {
  modelTestResult.value = []
  modelTestError.value = ''
})

async function loadOAuthCapabilities() {
  try {
    const data = await fetchOAuthCapabilities()
    oauthCapableProviders.value = data.providers || []
    vaultConfigured.value = data.vaultConfigured !== false
  } catch {
    /* best-effort — the "Connect via browser" button just won't show */
  }
}

function stopOAuthPolling() {
  if (oauthPollTimer) clearInterval(oauthPollTimer)
  oauthPollTimer = null
}

function pollOAuthStatus() {
  stopOAuthPolling()
  oauthPollTimer = setInterval(async () => {
    if (!oauthFlow.value.state) return
    try {
      const data = await fetchOAuthStatus(oauthFlow.value.state)
      if (data.status === 'done') {
        stopOAuthPolling()
        await loadCredentials()
        credentialId.value = data.credentialId
        showNewCredential.value = false
        oauthFlow.value = { state: '', status: 'idle', authorizeUrl: '', error: '' }
      } else if (data.status === 'error') {
        stopOAuthPolling()
        oauthFlow.value = { ...oauthFlow.value, status: 'error', error: data.error || 'connect failed' }
      }
    } catch {
      /* transient network hiccup — keep polling until the flow's own TTL expires */
    }
  }, 2000)
}

async function startConnectViaBrowser() {
  oauthFlow.value = { state: '', status: 'starting', authorizeUrl: '', error: '' }
  try {
    const data = await startOAuthConnect(providerId.value, newCred.value.label)
    oauthFlow.value = { state: data.state, status: 'pending', authorizeUrl: data.authorizeUrl, error: '' }
    window.open(data.authorizeUrl, '_blank', 'noopener')
    pollOAuthStatus()
  } catch (e: any) {
    oauthFlow.value = { state: '', status: 'error', authorizeUrl: '', error: String(e.message || e) }
  }
}

async function submitOAuthPaste() {
  if (!oauthFlow.value.state || !oauthPasteInput.value.trim()) return
  oauthFlow.value = { ...oauthFlow.value, status: 'exchanging' }
  try {
    const data = await exchangeOAuthCode(oauthFlow.value.state, oauthPasteInput.value.trim())
    stopOAuthPolling()
    await loadCredentials()
    credentialId.value = data.credentialId
    showNewCredential.value = false
    oauthPasteInput.value = ''
    oauthFlow.value = { state: '', status: 'idle', authorizeUrl: '', error: '' }
  } catch (e: any) {
    oauthFlow.value = { ...oauthFlow.value, status: 'error', error: String(e.message || e) }
  }
}

function cancelOAuthFlow() {
  stopOAuthPolling()
  oauthPasteInput.value = ''
  oauthFlow.value = { state: '', status: 'idle', authorizeUrl: '', error: '' }
}

function toggleNewCredential() {
  if (!showNewCredential.value) {
    newCred.value = { label: '', secretValue: '', secretRef: '' }
    cancelOAuthFlow()
  }
  showNewCredential.value = !showNewCredential.value
}

async function loadCredentials() {
  try {
    const data = await fetchCredentials()
    credentials.value = data.profiles || []
  } catch (e: any) {
    error.value = String(e.message || e)
  }
}

async function saveNewCredential() {
  error.value = ''
  if (!newCred.value.secretValue.trim() && !newCred.value.secretRef.trim()) {
    error.value = t('runner.errors.credentialSecretRequired')
    return
  }
  try {
    const { profile } = await saveCredential({
      label: newCred.value.label || undefined,
      provider: providerId.value,
      // Prefer the pasted value; the raw secretRef field is the advanced/legacy
      // path (env:VAR_NAME on the server, or file:/path) for operators who
      // already manage secrets that way.
      ...(newCred.value.secretValue.trim()
        ? { secretValue: newCred.value.secretValue }
        : { secretRef: newCred.value.secretRef }),
    })
    await loadCredentials()
    credentialId.value = profile.id
    showNewCredential.value = false
  } catch (e: any) {
    error.value = String(e.message || e)
  }
}

async function copyCredential(src: CredentialProfile) {
  error.value = ''
  const newId = `${src.id}-copy`
  try {
    const { profile } = await saveCredential({
      id: newId,
      label: `${src.label} (copy)`,
      provider: src.provider,
      secretRef: src.secretRef,
    })
    await loadCredentials()
    credentialId.value = profile.id
  } catch (e: any) {
    error.value = String(e.message || e)
  }
}

async function testModels() {
  modelTestError.value = ''
  loadingModels.value = true
  try {
    const data = await fetchAvailableModels({
      providerId: providerId.value,
      baseURL: baseURL.value.trim() || undefined,
      credentialId: !newCred.value.secretValue.trim() ? credentialId.value || undefined : undefined,
      secretValue: newCred.value.secretValue.trim() || undefined,
    })
    modelTestResult.value = data.models || []
    if (!modelTestResult.value.length) modelTestError.value = t('runner.providerDialog.noModelsFound')
  } catch (e: any) {
    modelTestError.value = e?.message ? String(e.message) : t('runner.providerDialog.testModelsFailed')
  } finally {
    loadingModels.value = false
  }
}

async function remove() {
  if (!props.providerConfig?.id) return
  if (!confirm(t('runner.providerDialog.deleteConfirm', { id: props.providerConfig.id }))) return
  try {
    await deleteProviderConfig(props.providerConfig.id)
    emit('close')
  } catch (e: any) {
    error.value = String(e.message || e)
  }
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    if (!label.value.trim()) {
      error.value = t('runner.providerDialog.labelRequired')
      return
    }
    if (!providerId.value) {
      error.value = t('runner.providerDialog.interfaceRequired')
      return
    }
    if (!credentialId.value) {
      error.value = t('runner.providerDialog.credentialRequired')
      return
    }
    const id = isEdit.value && props.providerConfig?.id
      ? props.providerConfig.id
      : slugify(label.value, { maxLength: 40, fallback: 'provider' })
    const { providerConfig } = await saveProviderConfig({
      id,
      label: label.value.trim(),
      providerId: providerId.value,
      credentialId: credentialId.value,
      ...(baseURL.value.trim() ? { baseURL: baseURL.value.trim() } : {}),
    })
    emit('saved', providerConfig.id)
    emit('close')
  } catch (e: any) {
    error.value = String(e.message || e)
  } finally {
    saving.value = false
  }
}

function applyPrefill() {
  const c = props.providerConfig
  if (!c?.id) {
    providerId.value = aiProviders.value[0]?.id || ''
    return
  }
  label.value = c.label || ''
  providerId.value = c.providerId || ''
  credentialId.value = c.credentialId || ''
  baseURL.value = typeof c.baseURL === 'string' ? c.baseURL : ''
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  emit('close')
}

onMounted(() => {
  applyPrefill()
  loadCredentials()
  loadOAuthCapabilities()
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  stopOAuthPolling()
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop nested-backdrop" @click.self="emit('close')">
      <div
        class="modal provider-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-dialog-title"
      >
        <div class="modal-head">
          <span id="provider-dialog-title">{{
            isEdit ? t('runner.providerDialog.editTitle') : t('runner.providerDialog.title')
          }}</span>
          <button type="button" class="modal-close" :aria-label="t('runner.a11y.close')" @click="emit('close')">✕</button>
        </div>

        <div class="modal-body">
          <div v-if="error" class="err-banner">{{ error }}</div>
          <p class="muted dialog-intro">{{ t('runner.providerDialog.intro') }}</p>

          <div class="field">
            <label class="cfg-label">{{ t('runner.providerDialog.labelField') }}
              <input v-model="label" class="cfg-input" :placeholder="t('runner.providerDialog.labelPlaceholder')" />
            </label>
          </div>

          <div class="field">
            <label class="cfg-label">{{ t('runner.providerDialog.interfaceField') }}
              <select v-model="providerId" class="cfg-input">
                <option v-for="p in aiProviders" :key="p.id" :value="p.id">{{ p.label }}</option>
              </select>
            </label>
          </div>

          <div class="field">
            <label class="cfg-label">Credential</label>
            <div class="credential-row">
              <select v-model="credentialId" class="cfg-input">
                <option value="" disabled>{{ t('runner.providerDialog.credentialPlaceholder') }}</option>
                <option v-for="c in filteredCredentials" :key="c.id" :value="c.id">
                  {{ c.label }} ({{ c.id }})
                </option>
              </select>
              <button
                type="button"
                class="icon-btn icon-btn-inline"
                :class="{ active: showNewCredential }"
                :title="t('runner.providerDialog.addCredential')"
                :aria-label="t('runner.providerDialog.addCredential')"
                @click="toggleNewCredential"
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M8 3v10M3 8h10" />
                </svg>
              </button>
            </div>
            <ul v-if="filteredCredentials.length" class="cred-actions">
              <li v-for="c in filteredCredentials" :key="`copy-${c.id}`">
                <button type="button" class="btn-ghost btn-sm" @click="copyCredential(c)">
                  Copy «{{ c.id }}»
                </button>
              </li>
            </ul>
          </div>
          <div v-if="showNewCredential" class="new-cred">
            <div class="field">
              <label class="cfg-label">{{ t('runner.connectionDialog.credLabelField') }}
                <input v-model="newCred.label" class="cfg-input" />
              </label>
            </div>

            <div v-if="canConnectOAuth" class="field oauth-block">
              <button
                type="button"
                class="btn-primary btn-sm"
                :disabled="oauthFlow.status === 'starting' || oauthFlow.status === 'pending' || oauthFlow.status === 'exchanging'"
                @click="startConnectViaBrowser"
              >
                {{ t('runner.connectionDialog.connectViaBrowser') }}
              </button>
              <p v-if="oauthFlow.status === 'pending'" class="muted path-hint">
                {{ t('runner.connectionDialog.oauthPendingHint') }}
              </p>
              <div v-if="oauthFlow.status === 'pending' || oauthFlow.status === 'exchanging'" class="oauth-paste-row">
                <input
                  v-model="oauthPasteInput"
                  class="cfg-input"
                  :placeholder="t('runner.connectionDialog.oauthPastePlaceholder')"
                />
                <button
                  type="button"
                  class="btn-ghost btn-sm"
                  :disabled="!oauthPasteInput.trim() || oauthFlow.status === 'exchanging'"
                  @click="submitOAuthPaste"
                >
                  {{ t('runner.connectionDialog.oauthPasteSubmit') }}
                </button>
              </div>
              <p v-if="oauthFlow.status === 'error'" class="muted err-text">{{ oauthFlow.error }}</p>
              <p class="muted path-hint">{{ t('runner.connectionDialog.orPasteSecretBelow') }}</p>
            </div>

            <p v-if="!vaultConfigured" class="err-text vault-warning">
              {{ t('runner.connectionDialog.vaultNotConfigured') }}
            </p>
            <div class="field">
              <label class="cfg-label">{{ t('runner.connectionDialog.secretValueField') }}
                <input
                  v-model="newCred.secretValue"
                  type="password"
                  class="cfg-input"
                  autocomplete="off"
                  :disabled="!vaultConfigured"
                />
              </label>
              <p class="muted path-hint">{{ t('runner.connectionDialog.secretValueHint') }}</p>
            </div>
            <details class="advanced-secret-ref">
              <summary class="muted">{{ t('runner.connectionDialog.advancedSecretRef') }}</summary>
              <div class="field">
                <label class="cfg-label">secretRef
                  <input v-model="newCred.secretRef" class="cfg-input" :placeholder="secretRefPlaceholder" />
                </label>
              </div>
            </details>
            <button type="button" class="btn-primary btn-sm" @click="saveNewCredential">{{ t('runner.connectionDialog.saveCredential') }}</button>
          </div>

          <div class="field">
            <span class="cfg-label label-with-hint">
              {{ t('runner.connectionDialog.baseUrlField') }}
              <InfoTooltip :text="t('runner.connectionDialog.baseUrlHint')" />
            </span>
            <input v-model="baseURL" class="cfg-input" :placeholder="baseUrlPlaceholder" />
          </div>

          <div class="field">
            <div class="row-actions">
              <span class="cfg-label">{{ t('runner.providerDialog.testSection') }}</span>
              <div class="row-btns">
                <button
                  type="button"
                  class="btn-ghost btn-sm"
                  :disabled="loadingModels || !canFetchModels"
                  @click="testModels"
                >
                  {{ loadingModels ? t('runner.connectionDialog.loadingModels') : t('runner.providerDialog.testModels') }}
                </button>
              </div>
            </div>
            <p v-if="modelTestError" class="muted err-text">{{ modelTestError }}</p>
            <p v-else-if="modelTestResult.length" class="muted path-hint">
              {{ t('runner.providerDialog.testOk', { count: modelTestResult.length }) }}
            </p>
          </div>

          <div class="modal-actions">
            <button
              v-if="isEdit"
              type="button"
              class="btn-danger btn-sm"
              @click="remove"
            >
              {{ t('runner.actions.delete') }}
            </button>
            <span class="spacer" />
            <button type="button" class="btn-ghost btn-sm" @click="emit('close')">{{ t('runner.actions.cancel') }}</button>
            <button type="button" class="btn-primary btn-sm" :disabled="saving" @click="save">
              {{ saving ? t('runner.actions.saving') : t('runner.providerDialog.save') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.provider-dialog { max-width: 520px; width: min(520px, 94vw); }
.nested-backdrop { z-index: 1100; }
.dialog-intro { margin: 0 0 0.75rem; }
.field { margin-bottom: 0.75rem; }
.field .cfg-input { width: 100%; }
.row-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}
.row-btns { display: flex; gap: 0.35rem; }
.label-with-hint { display: inline-flex; align-items: center; gap: 0.3rem; white-space: nowrap; flex-direction: row; }
.credential-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.credential-row .cfg-input { flex: 1; min-width: 0; }
.path-hint { margin: 0.35rem 0 0; }
.muted { color: var(--muted); font-size: 0.8rem; word-break: break-all; }
.cred-actions { list-style: none; padding: 0; margin: 0.4rem 0 0; display: flex; flex-wrap: wrap; gap: 0.25rem; }
.new-cred {
  border: 1px dashed var(--border);
  border-radius: 6px;
  padding: 0.75rem;
  margin-bottom: 0.75rem;
}
.oauth-block { border-bottom: 1px solid var(--border); padding-bottom: 0.75rem; margin-bottom: 0.75rem; }
.oauth-paste-row { display: flex; gap: 0.35rem; margin-top: 0.4rem; }
.oauth-paste-row .cfg-input { flex: 1; min-width: 0; }
.err-text { color: var(--danger); }
.vault-warning { margin: 0 0 0.5rem; font-size: 0.8rem; }
.advanced-secret-ref { margin-bottom: 0.75rem; }
.advanced-secret-ref summary { cursor: pointer; font-size: 0.8rem; }
.advanced-secret-ref .field { margin-top: 0.5rem; margin-bottom: 0; }
.modal-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; }
.modal-actions .spacer { flex: 1; }
.err-banner {
  background: rgba(248, 81, 73, 0.12);
  border: 1px solid var(--danger);
  color: var(--danger);
  padding: 0.5rem;
  border-radius: 6px;
  margin-bottom: 0.75rem;
}
</style>
