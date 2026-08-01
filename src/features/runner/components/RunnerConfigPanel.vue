<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useApp } from '../../../plugins'
import { fetchRunners, fetchJobs } from '../scripts/runnerApi'
import { saveRunner, deleteRunner, setDefaultRunner, fetchConnections } from '../scripts/RunnerConfigPanelApi'
import RunnerDialog from './RunnerDialog.vue'
import type { ProviderEntry, RunnerDraft } from '../types'

const app = useApp()
const t = (...args: any[]) => app.$t(...args) as string

const runners = ref<RunnerDraft[]>([])
const defaultRunnerId = ref('')
const connections = ref<{ id: string; label: string }[]>([])
const providers = ref<ProviderEntry[]>([])
const message = ref('')
const error = ref('')
const recentJobs = ref<any[]>([])
const showRunnerDialog = ref(false)
const editingRunner = ref<RunnerDraft | null>(null)

async function load() {
  error.value = ''
  try {
    const [rData, cData, jData] = await Promise.all([
      fetchRunners(),
      fetchConnections(),
      fetchJobs(10),
    ])
    runners.value = rData.runners || []
    defaultRunnerId.value = rData.defaultRunnerId || ''
    providers.value = (rData.providers || cData.providers || []) as ProviderEntry[]
    connections.value = cData.connections || rData.connections || []
    recentJobs.value = jData.jobs || []
    if (editingRunner.value?.id) {
      const updated = runners.value.find((r) => r.id === editingRunner.value?.id)
      if (updated) editingRunner.value = JSON.parse(JSON.stringify(updated))
    }
  } catch (e: any) {
    error.value = String(e.message || e)
  }
}

onMounted(load)

function openNew() {
  editingRunner.value = null
  showRunnerDialog.value = true
  message.value = ''
}

function openEdit(r: RunnerDraft) {
  editingRunner.value = JSON.parse(JSON.stringify(r))
  showRunnerDialog.value = true
  message.value = ''
}

function closeDialog() {
  showRunnerDialog.value = false
  editingRunner.value = null
}

async function onSaved(runnerId: string) {
  message.value = t('runner.messages.saved', { id: runnerId })
  await load()
}

function isEnabled(r: RunnerDraft): boolean {
  return r.enabled !== false
}

async function toggleEnabled(r: RunnerDraft, e: Event) {
  e.stopPropagation()
  try {
    await saveRunner({ ...r, enabled: !isEnabled(r) })
    message.value = isEnabled(r)
      ? t('runner.messages.disabled', { id: r.id })
      : t('runner.messages.enabled', { id: r.id })
    await load()
  } catch (err: any) {
    error.value = String(err.message || err)
  }
}

async function makeDefault(r: RunnerDraft, e: Event) {
  e.stopPropagation()
  try {
    await setDefaultRunner(r.id)
    message.value = `Default: ${r.id}`
    await load()
  } catch (err: any) {
    error.value = String(err.message || err)
  }
}

async function remove(r: RunnerDraft, e: Event) {
  e.stopPropagation()
  if (!confirm(t('runner.messages.confirmDelete', { id: r.id }))) return
  try {
    await deleteRunner(r.id)
    message.value = t('runner.messages.deleted')
    if (editingRunner.value?.id === r.id) closeDialog()
    await load()
  } catch (err: any) {
    error.value = String(err.message || err)
  }
}
</script>

<template>
  <div class="runner-config">
    <header class="runner-head">
      <h2>{{ t('runner.panel.title') }}</h2>
      <p class="muted">{{ t('runner.panel.subtitle') }}</p>
    </header>

    <div v-if="error" class="err-banner">{{ error }}</div>
    <div v-if="message" class="ok-banner">{{ message }}</div>

    <div class="runner-toolbar">
      <button type="button" class="btn-primary btn-sm" @click="openNew">{{ t('runner.panel.addRunner') }}</button>
    </div>

    <ul class="runner-list">
      <li v-if="!runners.length" class="empty muted">{{ t('runner.panel.empty') }}</li>
      <li
        v-for="r in runners"
        :key="r.id"
        :class="{ disabled: !isEnabled(r) }"
        @click="openEdit(r)"
      >
        <div class="runner-item-main">
          <strong>{{ r.name }}</strong>
          <span class="muted">{{ r.connectionId }}</span>
        </div>
        <div class="runner-item-actions" @click.stop>
          <button
            type="button"
            class="icon-btn"
            :class="{ active: isEnabled(r) }"
            :title="isEnabled(r) ? t('runner.toggle.disable') : t('runner.toggle.enable')"
            :aria-label="isEnabled(r) ? t('runner.toggle.disable') : t('runner.toggle.enable')"
            @click="toggleEnabled(r, $event)"
          >
            <!-- power -->
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
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
          <button
            type="button"
            class="icon-btn"
            :class="{ active: r.id === defaultRunnerId }"
            :disabled="r.id === defaultRunnerId"
            :title="t('runner.panel.makeDefault')"
            :aria-label="t('runner.panel.makeDefault')"
            @click="makeDefault(r, $event)"
          >
            <!-- star -->
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path
                :fill="r.id === defaultRunnerId ? 'currentColor' : 'none'"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linejoin="round"
                d="M8 2.2l1.6 3.3 3.6.5-2.6 2.6.6 3.6L8 10.5 4.8 12.2l.6-3.6L2.8 6l3.6-.5L8 2.2z"
              />
            </svg>
          </button>
          <button
            type="button"
            class="icon-btn danger"
            :title="t('runner.panel.deleteRunner')"
            :aria-label="t('runner.panel.deleteRunner')"
            @click="remove(r, $event)"
          >
            <!-- trash -->
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
      </li>
    </ul>

    <section v-if="recentJobs.length" class="recent-jobs">
      <h3>{{ t('runner.panel.recentJobs') }}</h3>
      <table>
        <thead>
          <tr><th>ID</th><th>Status</th><th>Agent</th><th>Created</th></tr>
        </thead>
        <tbody>
          <tr v-for="(j, idx) in recentJobs" :key="j.id || `job-${idx}`">
            <td>{{ j.id ? `${String(j.id).slice(0, 8)}…` : '—' }}</td>
            <td>{{ j.status }}</td>
            <td>{{ j.agentRef || '—' }}</td>
            <td>{{ j.createdAt || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <RunnerDialog
      v-if="showRunnerDialog"
      :runner="editingRunner"
      :connections="connections"
      :providers="providers"
      @close="closeDialog"
      @saved="onSaved"
      @refreshed="load"
    />
  </div>
</template>

<style scoped lang="scss">
.runner-config { padding: 1rem 1.25rem; max-width: 960px; }
.runner-head h2 { margin: 0 0 0.25rem; font-size: 1.25rem; font-weight: 500; }
.muted { color: var(--muted); font-size: 0.85rem; }
.runner-toolbar { margin: 1rem 0 0.75rem; }
.runner-list { list-style: none; padding: 0; margin: 0; max-width: 640px; }
.runner-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.65rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  margin-bottom: 6px;
  cursor: pointer;
}
.runner-list li:hover { border-color: var(--accent); background: var(--panel-2); }
.runner-list li.disabled { opacity: 0.45; }
.runner-list li.empty { cursor: default; border-style: dashed; opacity: 1; }
.runner-list li.empty:hover { border-color: var(--border); background: transparent; }
.runner-item-main { min-width: 0; flex: 1; }
.runner-item-main strong { display: block; font-size: 0.95rem; }
.runner-item-actions {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  flex-shrink: 0;
}
.err-banner {
  background: rgba(248, 81, 73, 0.12);
  border: 1px solid var(--danger);
  color: var(--danger);
  padding: 0.5rem;
  border-radius: 6px;
  margin: 0.5rem 0;
}
.ok-banner {
  background: rgba(63, 185, 80, 0.12);
  border: 1px solid var(--done);
  color: var(--done);
  padding: 0.5rem;
  border-radius: 6px;
  margin: 0.5rem 0;
}
.recent-jobs { margin-top: 2rem; }
.recent-jobs table { width: 100%; font-size: 0.85rem; border-collapse: collapse; }
.recent-jobs th, .recent-jobs td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--border); }
</style>
