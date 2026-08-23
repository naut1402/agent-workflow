<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { slugify } from '../../../core/lib/stringUtils'
import { saveRunner, submitJob, fetchJob } from '../scripts/RunnerDialogApi'
import { deleteConnection } from '../scripts/ConnectionDialogApi'
import ConnectionDialog from './ConnectionDialog.vue'
import type { ConnectionOption, ProviderEntry, RunnerDraft } from '../types'

const props = defineProps<{
  runner: RunnerDraft | null
  connections: ConnectionOption[]
  providers: ProviderEntry[]
}>()

const emit = defineEmits<{
  close: []
  saved: [runnerId: string]
  refreshed: []
}>()

const { t } = useI18nHelpers()

const TIMEOUT_OPTIONS = [
  { value: 300_000, labelKey: 'runner.timeoutOptions.min5' },
  { value: 600_000, labelKey: 'runner.timeoutOptions.min10' },
  { value: 900_000, labelKey: 'runner.timeoutOptions.min15' },
  { value: 1_800_000, labelKey: 'runner.timeoutOptions.min30' },
  { value: 3_600_000, labelKey: 'runner.timeoutOptions.hour1' },
] as const

function formatJobStatus(status: string | undefined): string {
  if (!status) return '—'
  const key = `runner.jobStatus.${status}`
  const translated = t(key)
  return translated !== key ? translated : status
}

const draft = ref(emptyDraft())
const isEdit = computed(() => Boolean(props.runner?.id))
const saving = ref(false)
const testing = ref(false)
const error = ref('')
const message = ref('')
const showConnectionDialog = ref(false)
const editingConnection = ref<ConnectionOption | null>(null)

function emptyDraft(): RunnerDraft {
  return {
    id: '',
    name: '',
    connectionId: props.connections[0]?.id || '',
    enabled: true,
    maxConcurrency: 1,
    config: {
      timeoutMs: 600000,
      allowedTools: 'Read,Write,Bash,Grep,Glob',
    },
  }
}

const selectedConnection = computed(
  () => props.connections.find((c) => c.id === draft.value.connectionId) || null,
)

const selectedProviderId = computed(() => selectedConnection.value?.providerId || '')

/** Claude Code CLI is the only local provider that understands --allowedTools. */
const showsAllowedTools = computed(() => selectedProviderId.value === 'claude-code-cli')

const isConsoleCommand = computed(() => selectedProviderId.value === 'console-command')

watch(
  () => props.runner,
  (r) => {
    draft.value = r ? JSON.parse(JSON.stringify(r)) : emptyDraft()
    if (!draft.value.connectionId && props.connections.length) {
      draft.value.connectionId = props.connections[0].id
    }
    if (!draft.value.config) draft.value.config = { timeoutMs: 600000 }
    error.value = ''
    message.value = ''
  },
  { immediate: true },
)

function buildSavePayload(): RunnerDraft {
  const config: RunnerDraft['config'] = {
    timeoutMs: draft.value.config?.timeoutMs ?? 600000,
  }
  // Only persist allowedTools for Claude Code CLI — other providers ignore / reject it.
  if (showsAllowedTools.value && draft.value.config?.allowedTools) {
    config.allowedTools = draft.value.config.allowedTools
  }
  return {
    ...draft.value,
    id: isEdit.value ? draft.value.id : slugify(draft.value.name, { fallback: 'runner' }),
    name: draft.value.name.trim(),
    config,
  }
}

async function save() {
  saving.value = true
  error.value = ''
  message.value = ''
  try {
    if (!draft.value.name.trim()) {
      error.value = t('runner.errors.nameRequired')
      return
    }
    if (!draft.value.connectionId) {
      error.value = t('runner.errors.connectionRequired')
      return
    }
    const payload = buildSavePayload()
    await saveRunner(payload)
    emit('saved', payload.id)
    emit('close')
  } catch (e: any) {
    error.value = String(e.message || e)
  } finally {
    saving.value = false
  }
}

async function smokeTest() {
  if (!draft.value.id) {
    error.value = t('runner.errors.saveBeforeTest')
    return
  }
  testing.value = true
  error.value = ''
  message.value = ''
  try {
    // Console command: no agent ref / system prompt — just run the registered CLI.
    const { job } = await submitJob(
      isConsoleCommand.value
        ? {
            runnerId: draft.value.id,
            agentRef: '',
            workspace: '.',
            userPrompt: '',
          }
        : {
            runnerId: draft.value.id,
            agentRef: 'dev-agent-teams:investigator',
            workspace: '.',
            userPrompt: 'Reply with exactly: OK',
          },
    )
    message.value = `Job ${job.id} — ${formatJobStatus(job.status)}`
    let current = job
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      const data = await fetchJob(job.id)
      current = data.job
      if (current.status === 'succeeded' || current.status === 'failed') break
    }
    message.value = `Smoke test: ${formatJobStatus(current.status)}${current.error ? ` — ${current.error}` : ''}`
    emit('refreshed')
  } catch (e: any) {
    error.value = String(e.message || e)
  } finally {
    testing.value = false
  }
}

function openNewConnection() {
  editingConnection.value = null
  showConnectionDialog.value = true
}

function openEditConnection() {
  const c = selectedConnection.value
  if (!c) return
  editingConnection.value = { ...c }
  showConnectionDialog.value = true
}

function openCopyConnection() {
  const c = selectedConnection.value
  if (!c) return
  editingConnection.value = { ...c, id: '', label: `${c.label} (copy)` }
  showConnectionDialog.value = true
}

async function removeConnection() {
  const c = selectedConnection.value
  if (!c) return
  if (!confirm(t('runner.messages.confirmDeleteConnection', { id: c.id }))) return
  error.value = ''
  try {
    await deleteConnection(c.id)
    message.value = t('runner.messages.connectionDeleted', { id: c.id })
    if (draft.value.connectionId === c.id) draft.value.connectionId = ''
    emit('refreshed')
  } catch (e: any) {
    error.value = String(e.message || e)
  }
}

async function onConnectionSaved(connectionId: string) {
  emit('refreshed')
  draft.value.connectionId = connectionId
  message.value = editingConnection.value?.id
    ? t('runner.messages.connectionSaved', { id: connectionId })
    : t('runner.messages.connectionAdded', { id: connectionId })
  editingConnection.value = null
}

function closeConnectionDialog() {
  showConnectionDialog.value = false
  editingConnection.value = null
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && !showConnectionDialog.value) emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="emit('close')">
      <div
        class="modal runner-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="runner-dialog-title"
      >
        <div class="modal-head">
          <span id="runner-dialog-title">{{ isEdit ? t('runner.dialog.editTitle') : t('runner.dialog.addTitle') }}</span>
          <button type="button" class="modal-close" :aria-label="t('runner.a11y.close')" @click="emit('close')">✕</button>
        </div>

        <div class="modal-body">
          <div v-if="error" class="err-banner">{{ error }}</div>
          <div v-if="message" class="ok-banner">{{ message }}</div>

          <div class="field">
            <label class="cfg-label">{{ t('runner.fields.name') }}
              <input v-model="draft.name" class="cfg-input" placeholder="vd. Claude local" />
            </label>
          </div>

          <div class="field">
            <label class="cfg-label">Connection</label>
            <div class="connection-row">
              <select v-model="draft.connectionId" class="cfg-input">
                <option value="" disabled>{{ t('runner.fields.connectionPlaceholder') }}</option>
                <option v-for="c in connections" :key="c.id" :value="c.id">
                  {{ c.label }}
                </option>
              </select>
              <div class="icon-btn-group">
                <button
                  type="button"
                  class="icon-btn icon-btn-inline"
                  :title="t('runner.connectionDialog.title')"
                  :aria-label="t('runner.connectionDialog.title')"
                  @click="openNewConnection"
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
                  :disabled="!selectedConnection"
                  :title="t('runner.connectionDialog.editTitle')"
                  :aria-label="t('runner.connectionDialog.editTitle')"
                  @click="openEditConnection"
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
                  class="icon-btn icon-btn-inline"
                  :disabled="!selectedConnection"
                  :title="t('runner.connectionDialog.copyConnection')"
                  :aria-label="t('runner.connectionDialog.copyConnection')"
                  @click="openCopyConnection"
                >
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                    <rect x="5.5" y="5.5" width="7" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.4" />
                    <path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" d="M3.5 10.5V3.5h7" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="icon-btn icon-btn-inline danger"
                  :disabled="!selectedConnection"
                  :title="t('runner.connectionDialog.deleteConnection')"
                  :aria-label="t('runner.connectionDialog.deleteConnection')"
                  @click="removeConnection"
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
            <p v-if="isConsoleCommand" class="muted hint">{{ t('runner.fields.consoleHint') }}</p>
          </div>

          <div v-if="showsAllowedTools" class="field">
            <label class="cfg-label">{{ t('runner.fields.allowedTools') }}
              <input v-model="draft.config.allowedTools" class="cfg-input" />
            </label>
          </div>

          <div class="field">
            <label class="cfg-label">{{ t('runner.fields.timeoutMs') }}
              <select v-model.number="draft.config.timeoutMs" class="cfg-input timeout-select">
                <option v-for="opt in TIMEOUT_OPTIONS" :key="opt.value" :value="opt.value">
                  {{ t(opt.labelKey) }}
                </option>
              </select>
            </label>
            <p class="muted hint">{{ t('runner.fields.timeoutMsHint') }}</p>
          </div>

          <div class="field enable-row">
            <span class="cfg-label">{{ t('runner.fields.status') }}</span>
            <button
              type="button"
              class="icon-btn"
              :class="{ active: draft.enabled }"
              :title="draft.enabled ? t('runner.toggle.disable') : t('runner.toggle.enable')"
              :aria-label="draft.enabled ? t('runner.toggle.disable') : t('runner.toggle.enable')"
              @click="draft.enabled = !draft.enabled"
            >
              <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  d="M8 2.5v5"
                />
                <path
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  d="M5.2 4.2a4.5 4.5 0 1 0 5.6 0"
                />
              </svg>
            </button>
            <span class="muted">{{ draft.enabled ? t('runner.status.on') : t('runner.status.off') }}</span>
          </div>

          <div class="modal-actions">
            <button
              v-if="isEdit"
              type="button"
              class="btn-ghost btn-sm"
              :disabled="testing"
              @click="smokeTest"
            >
              {{ testing ? t('runner.actions.testing') : t('runner.actions.test') }}
            </button>
            <span class="spacer" />
            <button type="button" class="btn-ghost btn-sm" @click="emit('close')">{{ t('runner.actions.cancel') }}</button>
            <button type="button" class="btn-primary btn-sm" :disabled="saving" @click="save">
              {{ saving ? t('runner.actions.saving') : t('runner.actions.save') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <ConnectionDialog
      v-if="showConnectionDialog"
      :providers="providers"
      :connection="editingConnection"
      @close="closeConnectionDialog"
      @saved="onConnectionSaved"
    />
  </Teleport>
</template>

<style scoped lang="scss">
.runner-dialog { max-width: 520px; width: min(520px, 94vw); }
.field { margin-bottom: 0.75rem; }
.field .cfg-input { width: 100%; }
.connection-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.connection-row .cfg-input { flex: 1; min-width: 0; }
.hint { margin: 0.35rem 0 0; font-size: 0.8rem; }
.enable-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.enable-row .cfg-label { margin: 0; }
.modal-body { display: flex; flex-direction: column; }
.modal-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-top: auto;
  padding-top: 1rem;
}
.spacer { flex: 1; }
.err-banner {
  background: rgba(248, 81, 73, 0.12);
  border: 1px solid var(--danger);
  color: var(--danger);
  padding: 0.5rem;
  border-radius: 6px;
  margin-bottom: 0.75rem;
}
.ok-banner {
  background: rgba(63, 185, 80, 0.12);
  border: 1px solid var(--done);
  color: var(--done);
  padding: 0.5rem;
  border-radius: 6px;
  margin-bottom: 0.75rem;
}
.muted { color: var(--muted); }
</style>
