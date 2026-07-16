<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { saveRunner, submitJob, fetchJob } from '../../../api'
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

const { t } = useI18n()

const draft = ref(emptyDraft())
const isEdit = computed(() => Boolean(props.runner?.id))
const saving = ref(false)
const testing = ref(false)
const error = ref('')
const message = ref('')
const showConnectionDialog = ref(false)

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

function slugify(text: string): string {
  const s = text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return s || 'runner'
}

watch(
  () => props.runner,
  (r) => {
    draft.value = r ? JSON.parse(JSON.stringify(r)) : emptyDraft()
    if (!draft.value.connectionId && props.connections.length) {
      draft.value.connectionId = props.connections[0].id
    }
    error.value = ''
    message.value = ''
  },
  { immediate: true },
)

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
    const payload = {
      ...draft.value,
      id: isEdit.value ? draft.value.id : slugify(draft.value.name),
      name: draft.value.name.trim(),
    }
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
    const { job } = await submitJob({
      runnerId: draft.value.id,
      agentRef: 'dev-agent-teams:investigator',
      workspace: '.',
      userPrompt: 'Reply with exactly: OK',
    })
    message.value = `Job ${job.id} — ${job.status}`
    let current = job
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      const data = await fetchJob(job.id)
      current = data.job
      if (current.status === 'succeeded' || current.status === 'failed') break
    }
    message.value = `Smoke test: ${current.status}${current.error ? ` — ${current.error}` : ''}`
    emit('refreshed')
  } catch (e: any) {
    error.value = String(e.message || e)
  } finally {
    testing.value = false
  }
}

async function onConnectionSaved(connectionId: string) {
  emit('refreshed')
  draft.value.connectionId = connectionId
  message.value = t('runner.messages.connectionAdded', { id: connectionId })
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
                  {{ c.label }} ({{ c.id }})
                </option>
              </select>
              <button
                type="button"
                class="btn-ghost btn-sm conn-add"
                :title="t('runner.connectionDialog.title')"
                @click="showConnectionDialog = true"
              >
                +
              </button>
            </div>
          </div>

          <div class="field">
            <label class="cfg-label">Allowed tools
              <input v-model="draft.config.allowedTools" class="cfg-input" />
            </label>
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
      @close="showConnectionDialog = false"
      @saved="onConnectionSaved"
    />
  </Teleport>
</template>

<style scoped>
.runner-dialog { max-width: 520px; width: min(520px, 94vw); }
.field { margin-bottom: 0.75rem; }
.field .cfg-input { width: 100%; }
.connection-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.connection-row .cfg-input { flex: 1; }
.conn-add { flex-shrink: 0; min-width: 2rem; font-size: 1.1rem; line-height: 1; }
.enable-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.enable-row .cfg-label { margin: 0; }
.modal-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
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
</style>
