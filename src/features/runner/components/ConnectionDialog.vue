<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { slugify } from '../../../core/lib/stringUtils'
import {
  saveConnection,
  scanLocalCommands,
  saveCustomCommand,
  deleteCustomCommand,
  fetchAvailableModels,
} from '../scripts/ConnectionDialogApi'
import { fetchProviderConfigs, saveProviderConfig } from '../scripts/ProviderDialogApi'
import { DEFAULT_MODEL_HINTS } from '../scripts/agenticProviderDefaults'
import type { ConnectionKind, ConnectionOption, ProviderConfigOption, ProviderEntry } from '../types'
import CComboSelect from '../../../core/ui/CComboSelect.vue'
import InfoTooltip from '../../../core/ui/InfoTooltip.vue'
import ProviderDialog from './ProviderDialog.vue'

interface RegisteredCommand {
  id: string
  command: string
  path: string
  available: boolean
  providerId: string
  flags: string[]
  custom?: boolean
}

const props = defineProps<{
  providers: ProviderEntry[]
  providerConfigs: ProviderConfigOption[]
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
const selectedCommandId = ref('')
/** Nullable by design — rotation across a provider's models is a future feature (see design.md). */
const selectedModels = ref<string[]>([])
const scanning = ref(false)
const saving = ref(false)
const error = ref('')
const scanned = ref<RegisteredCommand[]>([])
const customCommands = ref<RegisteredCommand[]>([])
const showRegisterCommand = ref(false)
const editingCommandId = ref<string | null>(null)
const registerDraft = ref({ command: '', path: '', flagsText: '' })
const registerError = ref('')

// ai-provider: everything provider-related (interface, credential, base URL)
// lives in a provider config; the connection just references it and picks models.
const selectedProviderConfigId = ref('')
const providerConfigList = ref<ProviderConfigOption[]>([...props.providerConfigs])
const showProviderDialog = ref(false)
const editingProviderConfig = ref<ProviderConfigOption | null>(null)

watch(
  () => props.providerConfigs,
  (list) => {
    providerConfigList.value = [...list]
  },
  { immediate: true },
)

const selectedProviderConfig = computed(
  () => providerConfigList.value.find((p) => p.id === selectedProviderConfigId.value) || null,
)

const modelPlaceholder = computed(() => DEFAULT_MODEL_HINTS[selectedProviderConfig.value?.providerId || ''] || '')

const modelOptions = ref<string[]>([])
const loadingModels = ref(false)
const modelFetchError = ref('')
/** Models are fetched through the provider config's credential — no separate key handling here. */
const canFetchModels = computed(() => Boolean(selectedProviderConfig.value))
/** Fetched models ∪ already-selected ones — so a model saved before a fresh "Load models" fetch still shows up. */
const modelSelectOptions = computed(() => {
  const ids = new Set(modelOptions.value)
  selectedModels.value.forEach((m) => ids.add(m))
  return Array.from(ids).map((m) => ({ value: m, label: m }))
})

/** UI only allows a single model today; `selectedModels` stays an array for the future rotate-across-models feature. */
const selectedModel = computed<string>({
  get: () => selectedModels.value[0] || '',
  set: (v) => {
    selectedModels.value = v ? [v] : []
  },
})

watch(selectedProviderConfigId, () => {
  modelOptions.value = []
  modelFetchError.value = ''
})

async function refreshProviderConfigs() {
  try {
    const data = await fetchProviderConfigs()
    providerConfigList.value = (data.providerConfigs || []) as ProviderConfigOption[]
  } catch {
    /* keep the props-provided list on failure */
  }
}

function openNewProviderConfig() {
  editingProviderConfig.value = null
  showProviderDialog.value = true
}

function openEditProviderConfig() {
  editingProviderConfig.value = selectedProviderConfig.value
  showProviderDialog.value = true
}

async function onProviderConfigSaved(id: string) {
  await refreshProviderConfigs()
  selectedProviderConfigId.value = id
}

async function loadModels() {
  if (!selectedProviderConfig.value) return
  modelFetchError.value = ''
  loadingModels.value = true
  try {
    const pc = selectedProviderConfig.value
    const data = await fetchAvailableModels({
      providerId: pc.providerId,
      baseURL: pc.baseURL || undefined,
      credentialId: pc.credentialId || undefined,
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

watch(
  kind,
  (k) => {
    if (k === 'ai-provider' && !selectedProviderConfigId.value) {
      selectedProviderConfigId.value = providerConfigList.value[0]?.id || ''
    }
  },
  { immediate: true },
)

watch(selectedCommandId, (id) => {
  const cmd = commandOptions.value.find((c) => c.id === id)
  if (cmd) {
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

/**
 * Auto-migrate a legacy connection (saved before the provider-config split) by
 * creating a matching provider config. This runs silently on edit — the user
 * sees the provider pre-selected and can save normally.
 */
async function migrateLegacyToProviderConfig(conn: ConnectionOption) {
  const id = `mig-${conn.id}`
  const baseURL = typeof conn.config?.baseURL === 'string' ? conn.config.baseURL : undefined
  try {
    const { providerConfig } = await saveProviderConfig({
      id,
      label: conn.label || conn.providerId || 'Migrated provider',
      providerId: conn.providerId || '',
      credentialId: conn.credentialId || '',
      ...(baseURL ? { baseURL } : {}),
    })
    providerConfigList.value.push(providerConfig)
    selectedProviderConfigId.value = providerConfig.id
  } catch {
    /* best-effort — dropdown stays empty, user can still create manually */
  }
}

function applyConnectionPrefill() {
  const c = props.connection
  if (!c) return
  label.value = c.label || ''
  kind.value = c.kind === 'ai-provider' ? 'ai-provider' : 'local-console'
  selectedModels.value = Array.isArray(c.config?.models)
    ? c.config.models.filter((m): m is string => typeof m === 'string')
    : typeof c.config?.model === 'string' && c.config.model
      ? [c.config.model]
      : []
  if (kind.value === 'ai-provider') {
    const link = typeof c.config?.providerConfigId === 'string' ? c.config.providerConfigId : ''
    if (link && providerConfigList.value.some((p) => p.id === link)) {
      selectedProviderConfigId.value = link
    } else {
      // Legacy connection (saved before the split): match on provider + credential.
      const match = providerConfigList.value.find(
        (p) => p.providerId === c.providerId && p.credentialId === c.credentialId,
      )
      if (match) {
        selectedProviderConfigId.value = match.id
      } else if (c.credentialId) {
        // Auto-migrate: create a provider config from the legacy connection
        // so the user can edit/save without losing their config.
        migrateLegacyToProviderConfig(c)
      }
    }
  }
  if (kind.value === 'local-console' && c.cliPath) {
    const match =
      commandOptions.value.find(
        (cmd) => cmd.path === c.cliPath || cmd.command === c.cliPath || cmd.id === c.cliPath,
      ) || null
    if (match) {
      selectedCommandId.value = match.id
    } else {
      const id = `edit-${c.id || slugifyConn(c.label || c.cliPath)}`
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
    if (props.connection) {
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

    const pc = selectedProviderConfig.value
    if (!pc) {
      error.value = t('runner.errors.providerConfigRequired')
      return
    }

    // Keep the connection self-contained (providerId + credentialId + baseURL
    // copied from the provider config) so the execution plane stays unchanged;
    // `providerConfigId` just remembers the link for the UI.
    const config: Record<string, unknown> = { providerConfigId: pc.id }
    if (selectedModels.value.length) {
      config.models = selectedModels.value
      // Legacy single-model field — kept for the provider wrappers, which pick
      // the first entry until the rotate-across-models feature lands.
      config.model = selectedModels.value[0]
    }
    if (pc.baseURL) config.baseURL = pc.baseURL

    const id = buildConnectionId(pc.providerId)
    const { connection } = await saveConnection({
      id,
      label: label.value.trim(),
      kind: 'ai-provider',
      providerId: pc.providerId,
      credentialId: pc.credentialId,
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
  if (showProviderDialog.value) {
    showProviderDialog.value = false
    return
  }
  if (showRegisterCommand.value) {
    showRegisterCommand.value = false
    return
  }
  emit('close')
}

onMounted(() => {
  refreshScan()
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
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
              <div class="row-actions">
                <span class="cfg-label label-with-hint">
                  {{ t('runner.connectionDialog.providerField') }}
                  <InfoTooltip :text="t('runner.connectionDialog.providerHint')" />
                </span>
              </div>
              <div class="command-row">
                <select v-model="selectedProviderConfigId" class="cfg-input">
                  <option value="" disabled>{{ t('runner.connectionDialog.providerPlaceholder') }}</option>
                  <option v-for="pc in providerConfigList" :key="pc.id" :value="pc.id">
                    {{ pc.label }} ({{ pc.providerId }})
                  </option>
                </select>
                <div class="icon-btn-group">
                  <button
                    type="button"
                    class="icon-btn icon-btn-inline"
                    :title="t('runner.providerDialog.title')"
                    :aria-label="t('runner.providerDialog.title')"
                    @click="openNewProviderConfig"
                  >
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                      <path
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="round"
                        d="M8 3v10M3 8h10"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    class="icon-btn icon-btn-inline"
                    :disabled="!selectedProviderConfig"
                    :title="t('runner.providerDialog.editTitle')"
                    :aria-label="t('runner.providerDialog.editTitle')"
                    @click="openEditProviderConfig"
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
                </div>
              </div>
              <p v-if="!providerConfigList.length" class="muted path-hint">
                {{ t('runner.connectionDialog.noProviderConfigs') }}
              </p>
            </div>
            <div class="field">
              <div class="row-actions">
                <span class="cfg-label label-with-hint">
                  {{ t('runner.connectionDialog.modelField') }}
                  <InfoTooltip :text="t('runner.connectionDialog.modelHint')" />
                </span>
              </div>
              <div class="command-row">
                <CComboSelect
                  v-model="selectedModel"
                  :options="modelSelectOptions"
                  :placeholder="modelPlaceholder || t('runner.connectionDialog.modelSelectPlaceholder')"
                  :aria-label="t('runner.connectionDialog.modelField')"
                  class="cfg-combo-select"
                  creatable
                />
                <button
                  type="button"
                  class="icon-btn icon-btn-inline"
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
              </div>
              <p v-if="modelFetchError" class="muted err-text">{{ modelFetchError }}</p>
              <p v-else-if="modelOptions.length" class="muted path-hint">
                {{ t('runner.connectionDialog.modelsLoaded', { count: modelOptions.length }) }}
              </p>
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

    <ProviderDialog
      v-if="showProviderDialog"
      :providers="providers"
      :providerConfig="editingProviderConfig"
      @close="showProviderDialog = false"
      @saved="onProviderConfigSaved"
    />
  </Teleport>
</template>

<style scoped lang="scss">
.connection-dialog { max-width: 520px; width: min(520px, 94vw); min-height: 560px; }
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
.label-with-hint { display: inline-flex; align-items: center; gap: 0.3rem; white-space: nowrap; flex-direction: row; }
.command-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.command-row .cfg-input { flex: 1; min-width: 0; }
.cfg-combo-select { flex: 1; min-width: 0; }
.icon-btn-group { display: inline-flex; align-items: center; gap: 0.15rem; flex-shrink: 0; }
.path-hint { margin: 0.35rem 0 0; }
.muted { color: var(--muted); font-size: 0.8rem; word-break: break-all; }
.err-text { color: var(--danger); }
.modal-body { display: flex; flex-direction: column; }
.modal-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: auto; padding-top: 1rem; }
.err-banner {
  background: rgba(248, 81, 73, 0.12);
  border: 1px solid var(--danger);
  color: var(--danger);
  padding: 0.5rem;
  border-radius: 6px;
  margin-bottom: 0.75rem;
}
</style>
