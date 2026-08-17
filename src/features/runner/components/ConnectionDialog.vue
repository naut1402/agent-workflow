<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { slugify } from '../../../core/lib/stringUtils'
import {
  fetchCredentials,
  saveCredential,
  saveConnection,
  scanLocalCommands,
  saveCustomCommand,
  deleteCustomCommand,
  fetchOAuthCapabilities,
  startOAuthConnect,
  exchangeOAuthCode,
  fetchOAuthStatus,
  fetchAvailableModels,
} from '../scripts/ConnectionDialogApi'
import { DEFAULT_BASE_URLS, DEFAULT_MODEL_HINTS, DEFAULT_SECRET_ENV_HINTS } from '../scripts/agenticProviderDefaults'
import type { ConnectionKind, ConnectionOption, ProviderEntry } from '../types'
import CMultiSelect from '../../../core/ui/CMultiSelect.vue'
import InfoTooltip from '../../../core/ui/InfoTooltip.vue'

interface RegisteredCommand {
  id: string
  command: string
  path: string
  available: boolean
  providerId: string
  flags: string[]
  custom?: boolean
}

interface CredentialProfile {
  id: string
  provider: string
  label: string
  secretRef: string
}

const props = defineProps<{
  providers: ProviderEntry[]
  /** When set — edit existing connection (id preserved). */
  connection?: ConnectionOption | null
}>()

const emit = defineEmits<{
  close: []
  saved: [connectionId: string]
}>()

const { t } = useI18nHelpers()

const isEdit = computed(() => Boolean(props.connection?.id))

const kind = ref<ConnectionKind>('local-console')
const label = ref('')
const providerId = ref('')
const selectedCommandId = ref('')
const credentialId = ref('')
/** Nullable by design — rotation across a provider's models is a future feature (see design.md). */
const selectedModels = ref<string[]>([])
const baseURL = ref('')
/** Base URL input is opt-in behind a toggle — most connections use the provider's default endpoint. */
const showBaseUrl = ref(false)
const scanning = ref(false)
const saving = ref(false)
const error = ref('')
const scanned = ref<RegisteredCommand[]>([])
const customCommands = ref<RegisteredCommand[]>([])
const credentials = ref<CredentialProfile[]>([])
const showNewCredential = ref(false)
const showRegisterCommand = ref(false)
const editingCommandId = ref<string | null>(null)
/** `id` intentionally not user-facing anymore — upsertCredential mints one when omitted. */
const newCred = ref({ label: '', secretValue: '', secretRef: '' })
const modelPlaceholder = computed(() => DEFAULT_MODEL_HINTS[providerId.value] || '')
const baseUrlPlaceholder = computed(() => DEFAULT_BASE_URLS[providerId.value] || '')
/** Hint only — must stay a placeholder, not a prefilled value, or "field left untouched" becomes indistinguishable from "field filled with the hint". */
const secretRefPlaceholder = computed(() => DEFAULT_SECRET_ENV_HINTS[providerId.value] || 'env:ANTHROPIC_API_KEY')

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
const registerDraft = ref({ command: '', path: '', flagsText: '' })
const registerError = ref('')

const aiProviders = computed(() => props.providers.filter((p) => p.kind === 'ai-provider'))

const modelOptions = ref<string[]>([])
const loadingModels = ref(false)
const modelFetchError = ref('')
/** A key to fetch models with — an existing credential, or a not-yet-saved secret typed in "+ Credential". */
const canFetchModels = computed(() => Boolean(providerId.value && (credentialId.value || newCred.value.secretValue.trim())))
/** Fetched models ∪ already-selected ones — so a model saved before a fresh "Load models" fetch still shows up. */
const modelSelectOptions = computed(() => {
  const ids = new Set(modelOptions.value)
  selectedModels.value.forEach((m) => ids.add(m))
  return Array.from(ids).map((m) => ({ value: m, label: m }))
})

watch([providerId, credentialId], () => {
  modelOptions.value = []
  modelFetchError.value = ''
})

async function loadModels() {
  modelFetchError.value = ''
  loadingModels.value = true
  try {
    const data = await fetchAvailableModels({
      providerId: providerId.value,
      baseURL: showBaseUrl.value ? baseURL.value.trim() || undefined : undefined,
      credentialId: !newCred.value.secretValue.trim() ? credentialId.value || undefined : undefined,
      secretValue: newCred.value.secretValue.trim() || undefined,
    })
    modelOptions.value = data.models || []
    if (!modelOptions.value.length) modelFetchError.value = t('runner.connectionDialog.noModelsFound')
  } catch (e: any) {
    modelFetchError.value = e?.message ? String(e.message) : t('runner.connectionDialog.loadModelsFailed')
  } finally {
    loadingModels.value = false
  }
}

const commandOptions = computed(() => [...scanned.value, ...customCommands.value])

const selectedCommand = computed(
  () => commandOptions.value.find((c) => c.id === selectedCommandId.value) || null,
)

const filteredCredentials = computed(() =>
  credentials.value.filter((c) => !providerId.value || c.provider === providerId.value),
)

watch(
  kind,
  (k) => {
    if (k === 'ai-provider') {
      if (!aiProviders.value.some((p) => p.id === providerId.value)) {
        providerId.value = aiProviders.value[0]?.id || ''
      }
    }
  },
  { immediate: true },
)

watch(selectedCommandId, (id) => {
  const cmd = commandOptions.value.find((c) => c.id === id)
  if (cmd) {
    providerId.value = cmd.providerId
    if (!label.value.trim()) label.value = cmd.command
  }
})

function slugifyConn(text: string): string {
  return slugify(text, { maxLength: 40, fallback: 'conn' })
}

function buildConnectionId(resolvedProvider: string): string {
  if (isEdit.value && props.connection?.id) return props.connection.id
  const base = slugifyConn(label.value) || resolvedProvider
  const suffix = kind.value === 'local-console' ? 'local' : 'api'
  return `${base}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
}

function inferProviderFromPath(pathOrCmd: string): string {
  const base =
    pathOrCmd
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      ?.replace(/\.(exe|cmd|bat|ps1)$/i, '') || ''
  const known = scanned.value.find((c) => c.command === base || c.id === base)
  if (known) return known.providerId
  if (/^claude$/i.test(base)) return 'claude-code-cli'
  if (/^(agent|cursor-agent)$/i.test(base) || /cursor-agent/i.test(pathOrCmd)) return 'cursor-cli'
  if (/codex/i.test(base)) return 'codex-cli'
  return 'console-command'
}

async function loadCredentials() {
  try {
    const data = await fetchCredentials()
    credentials.value = data.profiles || []
  } catch (e: any) {
    error.value = String(e.message || e)
  }
}

function applyConnectionPrefill() {
  const c = props.connection
  if (!c?.id) return
  label.value = c.label || ''
  kind.value = c.kind === 'ai-provider' ? 'ai-provider' : 'local-console'
  providerId.value = c.providerId || ''
  credentialId.value = c.credentialId || ''
  selectedModels.value = Array.isArray(c.config?.models)
    ? c.config.models.filter((m): m is string => typeof m === 'string')
    : typeof c.config?.model === 'string' && c.config.model
      ? [c.config.model]
      : []
  baseURL.value = typeof c.config?.baseURL === 'string' ? c.config.baseURL : ''
  showBaseUrl.value = Boolean(baseURL.value)
  if (kind.value === 'local-console' && c.cliPath) {
    const match =
      commandOptions.value.find(
        (cmd) => cmd.path === c.cliPath || cmd.command === c.cliPath || cmd.id === c.cliPath,
      ) || null
    if (match) {
      selectedCommandId.value = match.id
    } else {
      const id = `edit-${c.id}`
      customCommands.value = [
        {
          id,
          command: c.label || c.cliPath,
          path: c.cliPath,
          available: true,
          providerId: c.providerId || 'console-command',
          flags: Array.isArray(c.flags) ? c.flags : [],
          custom: true,
        },
        ...customCommands.value.filter((x) => x.id !== id),
      ]
      selectedCommandId.value = id
    }
  }
}

async function refreshScan() {
  scanning.value = true
  error.value = ''
  try {
    const data = await scanLocalCommands()
    const all = (data.commands || []) as RegisteredCommand[]
    scanned.value = all
      .filter((c) => !c.custom)
      .map((c) => ({
        id: c.id,
        command: c.command,
        path: c.path || c.command,
        available: Boolean(c.available),
        providerId: c.providerId,
        flags: Array.isArray(c.flags) ? c.flags : [],
        custom: false,
      }))
    customCommands.value = all
      .filter((c) => c.custom)
      .map((c) => ({
        id: c.id,
        command: c.command,
        path: c.path || c.command,
        available: true,
        providerId: c.providerId,
        flags: Array.isArray(c.flags) ? c.flags : [],
        custom: true,
      }))
    if (props.connection?.id) {
      applyConnectionPrefill()
    } else if (!selectedCommandId.value) {
      const firstAvail = scanned.value.find((c) => c.available) || scanned.value[0]
      if (firstAvail) selectedCommandId.value = firstAvail.id
    }
  } catch (e: any) {
    error.value = String(e.message || e)
  } finally {
    scanning.value = false
  }
}

function openRegisterCommand() {
  registerError.value = ''
  editingCommandId.value = null
  registerDraft.value = { command: '', path: '', flagsText: '' }
  showRegisterCommand.value = true
}

function openEditCommand(cmd: RegisteredCommand) {
  if (!cmd.custom) return
  registerError.value = ''
  editingCommandId.value = cmd.id
  registerDraft.value = {
    command: cmd.command,
    path: cmd.path,
    flagsText: (cmd.flags || []).join(' '),
  }
  showRegisterCommand.value = true
}

async function confirmRegisterCommand() {
  registerError.value = ''
  const path = registerDraft.value.path.trim()
  if (!path) {
    registerError.value = t('runner.errors.cliPathRequired')
    return
  }
  const command =
    registerDraft.value.command.trim() ||
    path.replace(/\\/g, '/').split('/').pop()?.replace(/\.(exe|cmd|bat|ps1)$/i, '') ||
    'custom'
  const id =
    editingCommandId.value ||
    `custom-${slugify(command)}-${Date.now().toString(36).slice(-4)}`
  const flags = registerDraft.value.flagsText
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const entry: RegisteredCommand = {
    id,
    command,
    path,
    available: true,
    providerId: inferProviderFromPath(path),
    flags,
    custom: true,
  }
  try {
    await saveCustomCommand({
      id: entry.id,
      command: entry.command,
      path: entry.path,
      providerId: entry.providerId,
      flags: entry.flags,
    })
    const idx = customCommands.value.findIndex((c) => c.id === id)
    if (idx >= 0) customCommands.value[idx] = entry
    else customCommands.value.push(entry)
    selectedCommandId.value = entry.id
    if (!label.value.trim()) label.value = command
    showRegisterCommand.value = false
    editingCommandId.value = null
  } catch (e: any) {
    registerError.value = String(e.message || e)
  }
}

async function removeCustomCommand(cmd: RegisteredCommand) {
  if (!cmd.custom) return
  if (!confirm(t('runner.messages.confirmDeleteCommand', { id: cmd.id }))) return
  try {
    await deleteCustomCommand(cmd.id)
    customCommands.value = customCommands.value.filter((c) => c.id !== cmd.id)
    if (selectedCommandId.value === cmd.id) {
      selectedCommandId.value = scanned.value.find((c) => c.available)?.id || scanned.value[0]?.id || ''
    }
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

async function save() {
  saving.value = true
  error.value = ''
  try {
    if (!label.value.trim()) {
      error.value = t('runner.errors.connLabelRequired')
      return
    }

    if (kind.value === 'local-console') {
      const cmd = selectedCommand.value
      if (!cmd) {
        error.value = t('runner.errors.commandRequired')
        return
      }
      const resolvedProvider = cmd.providerId
      const id = buildConnectionId(resolvedProvider)
      const { connection } = await saveConnection({
        id,
        label: label.value.trim(),
        kind: 'local-console',
        providerId: resolvedProvider,
        cliPath: cmd.path || cmd.command,
        flags: cmd.flags || [],
      })
      emit('saved', connection.id)
      emit('close')
      return
    }

    const config: Record<string, unknown> = {}
    if (selectedModels.value.length) {
      config.models = selectedModels.value
      // Legacy single-model field — kept for the provider wrappers, which pick
      // the first entry until the rotate-across-models feature lands.
      config.model = selectedModels.value[0]
    }
    if (showBaseUrl.value && baseURL.value.trim()) config.baseURL = baseURL.value.trim()

    const id = buildConnectionId(providerId.value)
    const { connection } = await saveConnection({
      id,
      label: label.value.trim(),
      kind: 'ai-provider',
      providerId: providerId.value,
      credentialId: credentialId.value,
      config,
    })
    emit('saved', connection.id)
    emit('close')
  } catch (e: any) {
    error.value = String(e.message || e)
  } finally {
    saving.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (showRegisterCommand.value) {
    showRegisterCommand.value = false
    return
  }
  emit('close')
}

onMounted(() => {
  loadCredentials()
  loadOAuthCapabilities()
  refreshScan()
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  stopOAuthPolling()
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="emit('close')">
      <div
        class="modal connection-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-dialog-title"
      >
        <div class="modal-head">
          <span id="connection-dialog-title">{{
            isEdit ? t('runner.connectionDialog.editTitle') : t('runner.connectionDialog.title')
          }}</span>
          <button type="button" class="modal-close" :aria-label="t('runner.a11y.close')" @click="emit('close')">✕</button>
        </div>

        <div class="modal-body">
          <div v-if="error" class="err-banner">{{ error }}</div>

          <div class="field">
            <label class="cfg-label">{{ t('runner.connectionDialog.labelField') }}
              <input v-model="label" class="cfg-input" placeholder="vd. Claude local" />
            </label>
          </div>

          <div class="field">
            <span class="cfg-label">{{ t('runner.connectionDialog.kind') }}</span>
            <div class="kind-radios" role="radiogroup" :aria-label="t('runner.connectionDialog.kindGroup')">
              <label class="kind-radio">
                <input v-model="kind" type="radio" value="local-console" :disabled="isEdit" />
                Local console
              </label>
              <label class="kind-radio">
                <input v-model="kind" type="radio" value="ai-provider" :disabled="isEdit" />
                AI provider
              </label>
            </div>
          </div>

          <template v-if="kind === 'local-console'">
            <div class="field">
              <div class="row-actions">
                <label class="cfg-label" for="conn-command">Command</label>
                <div class="row-btns">
                  <button type="button" class="btn-ghost btn-sm" :disabled="scanning" @click="refreshScan">
                    {{ scanning ? t('runner.connectionDialog.scanning') : t('runner.actions.refresh') }}
                  </button>
                  <button type="button" class="btn-ghost btn-sm" @click="openRegisterCommand">
                    {{ t('runner.connectionDialog.register') }}
                  </button>
                </div>
              </div>
              <div class="command-row">
                <select id="conn-command" v-model="selectedCommandId" class="cfg-input">
                  <option value="" disabled>{{ t('runner.connectionDialog.commandPlaceholder') }}</option>
                  <option v-for="c in commandOptions" :key="c.id" :value="c.id">
                    {{ c.command }}{{ c.available ? '' : t('runner.connectionDialog.notOnPath') }}{{ c.custom ? t('runner.connectionDialog.custom') : '' }}
                  </option>
                </select>
                <div v-if="selectedCommand?.custom" class="icon-btn-group">
                  <button
                    type="button"
                    class="icon-btn icon-btn-inline"
                    :title="t('runner.connectionDialog.editCommand')"
                    :aria-label="t('runner.connectionDialog.editCommand')"
                    @click="openEditCommand(selectedCommand)"
                  >
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                      <path
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.4"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M9.5 3.5l3 3L5 14H2v-3L9.5 3.5zM8 5l3 3"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    class="icon-btn icon-btn-inline danger"
                    :title="t('runner.connectionDialog.deleteCommand')"
                    :aria-label="t('runner.connectionDialog.deleteCommand')"
                    @click="removeCustomCommand(selectedCommand)"
                  >
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                      <path
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.4"
                        stroke-linecap="round"
                        d="M3.5 5h9M6 5V3.5h4V5M5 5l.5 8h5L11 5"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <p
                v-if="selectedCommand?.path && selectedCommand.path !== selectedCommand.command"
                class="muted path-hint"
              >
                {{ selectedCommand.path }}
              </p>
            </div>
          </template>

          <template v-else>
            <div class="field">
              <label class="cfg-label">Interface
                <select v-model="providerId" class="cfg-input">
                  <option v-for="p in aiProviders" :key="p.id" :value="p.id">{{ p.label }}</option>
                </select>
              </label>
            </div>
            <div class="field">
              <div class="row-actions">
                <label class="cfg-label">Credential</label>
                <div class="row-btns">
                  <button type="button" class="btn-ghost btn-sm" @click="toggleNewCredential">
                    + Credential
                  </button>
                </div>
              </div>
              <select v-model="credentialId" class="cfg-input">
                <option value="" disabled>{{ t('runner.connectionDialog.credentialPlaceholder') }}</option>
                <option v-for="c in filteredCredentials" :key="c.id" :value="c.id">
                  {{ c.label }} ({{ c.id }})
                </option>
              </select>
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
              <div class="row-actions">
                <span class="cfg-label label-with-hint">
                  {{ t('runner.connectionDialog.modelField') }}
                  <InfoTooltip :text="t('runner.connectionDialog.modelHint')" />
                </span>
                <div class="row-btns">
                  <button
                    type="button"
                    class="icon-btn"
                    :disabled="loadingModels || !canFetchModels"
                    :title="loadingModels ? t('runner.connectionDialog.loadingModels') : t('runner.connectionDialog.loadModels')"
                    :aria-label="loadingModels ? t('runner.connectionDialog.loadingModels') : t('runner.connectionDialog.loadModels')"
                    @click="loadModels"
                  >
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                      <path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" d="M13 8a5 5 0 1 1-1.6-3.6" />
                      <path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" d="M13 2.8v3.4h-3.4" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    :class="{ active: showBaseUrl }"
                    :title="showBaseUrl ? t('runner.connectionDialog.hideBaseUrl') : t('runner.connectionDialog.showBaseUrl')"
                    :aria-label="showBaseUrl ? t('runner.connectionDialog.hideBaseUrl') : t('runner.connectionDialog.showBaseUrl')"
                    @click="showBaseUrl = !showBaseUrl"
                  >
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                      <path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M6.5 9.5 9.5 6.5" />
                      <path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M7.8 4.6 9 3.4a2.3 2.3 0 0 1 3.3 3.3l-1.2 1.2" />
                      <path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M8.2 11.4 7 12.6a2.3 2.3 0 0 1-3.3-3.3l1.2-1.2" />
                    </svg>
                  </button>
                </div>
              </div>
              <CMultiSelect
                v-model="selectedModels"
                :options="modelSelectOptions"
                :placeholder="modelPlaceholder || t('runner.connectionDialog.modelSelectPlaceholder')"
                :aria-label="t('runner.connectionDialog.modelField')"
              />
              <p v-if="modelFetchError" class="muted err-text">{{ modelFetchError }}</p>
              <p v-else-if="modelOptions.length" class="muted path-hint">
                {{ t('runner.connectionDialog.modelsLoaded', { count: modelOptions.length }) }}
              </p>
              <div v-if="showBaseUrl" class="base-url-field">
                <span class="cfg-label label-with-hint">
                  {{ t('runner.connectionDialog.baseUrlField') }}
                  <InfoTooltip :text="t('runner.connectionDialog.baseUrlHint')" />
                </span>
                <input v-model="baseURL" class="cfg-input" :placeholder="baseUrlPlaceholder" />
              </div>
            </div>
          </template>

          <div class="modal-actions">
            <button type="button" class="btn-ghost btn-sm" @click="emit('close')">{{ t('runner.actions.cancel') }}</button>
            <button type="button" class="btn-primary btn-sm" :disabled="saving" @click="save">
              {{ saving ? t('runner.actions.saving') : t('runner.connectionDialog.saveConnection') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="showRegisterCommand"
      class="modal-backdrop nested-backdrop"
      @click.self="showRegisterCommand = false"
    >
      <div
        class="modal register-command-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="register-command-title"
      >
        <div class="modal-head">
          <span id="register-command-title">{{
            editingCommandId ? t('runner.registerDialog.editTitle') : t('runner.registerDialog.title')
          }}</span>
          <button
            type="button"
            class="modal-close"
            :aria-label="t('runner.a11y.close')"
            @click="showRegisterCommand = false"
          >
            ✕
          </button>
        </div>
        <div class="modal-body">
          <div v-if="registerError" class="err-banner">{{ registerError }}</div>
          <div class="field">
            <label class="cfg-label">{{ t('runner.registerDialog.commandField') }}
              <input v-model="registerDraft.command" class="cfg-input" :placeholder="t('runner.registerDialog.commandPlaceholder')" />
            </label>
          </div>
          <div class="field">
            <label class="cfg-label">CLI path
              <input
                v-model="registerDraft.path"
                class="cfg-input"
                :placeholder="t('runner.registerDialog.pathPlaceholder')"
              />
            </label>
          </div>
          <div class="field">
            <label class="cfg-label">{{ t('runner.registerDialog.flagsField') }}
              <input v-model="registerDraft.flagsText" class="cfg-input" placeholder="vd. --print" />
            </label>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn-ghost btn-sm" @click="showRegisterCommand = false">{{ t('runner.actions.cancel') }}</button>
            <button type="button" class="btn-primary btn-sm" @click="confirmRegisterCommand">
              {{ editingCommandId ? t('runner.actions.save') : t('runner.registerDialog.addToList') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.connection-dialog { max-width: 520px; width: min(520px, 94vw); }
.register-command-dialog { max-width: 440px; width: min(440px, 92vw); }
.nested-backdrop { z-index: 1100; }
.kind-radios { display: flex; gap: 1rem; margin-top: 0.35rem; flex-wrap: wrap; }
.kind-radio {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
  font-size: 0.9rem;
}
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
.label-with-hint { display: inline-flex; align-items: center; gap: 0.3rem; }
.base-url-field { margin-top: 0.6rem; }
.base-url-field .cfg-input { width: 100%; }
.command-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.command-row .cfg-input { flex: 1; min-width: 0; }
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
.err-banner {
  background: rgba(248, 81, 73, 0.12);
  border: 1px solid var(--danger);
  color: var(--danger);
  padding: 0.5rem;
  border-radius: 6px;
  margin-bottom: 0.75rem;
}
</style>
