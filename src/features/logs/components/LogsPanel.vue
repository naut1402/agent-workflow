<script setup lang="ts">
import { ref, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { fetchLogs, fetchJobs, fetchJobLog } from '../../../api'

const { t } = useI18n()

type Tab = 'audit' | 'request' | 'jobs'

const tab = ref<Tab>('audit')
const entries = ref<any[]>([])
const jobs = ref<any[]>([])
const selectedJobId = ref('')
const jobLog = ref('')
const jobLogTruncated = ref(false)
const tailing = ref(false)
const loading = ref(false)
const error = ref('')

let tailTimer: ReturnType<typeof setInterval> | null = null

function stopTail() {
  if (tailTimer) {
    clearInterval(tailTimer)
    tailTimer = null
  }
  tailing.value = false
}

async function loadLogs(type: 'audit' | 'request') {
  loading.value = true
  error.value = ''
  try {
    const data = await fetchLogs({ type, limit: 200 })
    if (tab.value !== type) return
    entries.value = data.entries || []
  } catch (e: any) {
    if (tab.value !== type) return
    error.value = String(e.message || e)
  } finally {
    if (tab.value === type) loading.value = false
  }
}

async function loadJobs() {
  loading.value = true
  error.value = ''
  try {
    const data = await fetchJobs(20)
    if (tab.value !== 'jobs') return
    jobs.value = data.jobs || []
  } catch (e: any) {
    if (tab.value !== 'jobs') return
    error.value = String(e.message || e)
  } finally {
    if (tab.value === 'jobs') loading.value = false
  }
}

async function loadJobLog(id: string) {
  try {
    const data = await fetchJobLog(id)
    if (selectedJobId.value !== id) return
    jobLog.value = data.text || ''
    jobLogTruncated.value = Boolean(data.truncated)
  } catch (e: any) {
    if (selectedJobId.value !== id) return
    error.value = String(e.message || e)
  }
}

function selectJob(id: string) {
  stopTail()
  selectedJobId.value = id
  jobLog.value = ''
  loadJobLog(id)
}

function toggleTail() {
  if (tailing.value) {
    stopTail()
    return
  }
  if (!selectedJobId.value) return
  tailing.value = true
  tailTimer = setInterval(() => {
    if (selectedJobId.value) loadJobLog(selectedJobId.value)
  }, 1500)
}

function selectTab(t: Tab) {
  stopTail()
  tab.value = t
}

// React to tab changes (covers both programmatic and click-driven switches).
watch(
  tab,
  (t) => {
    if (t === 'audit') loadLogs('audit')
    else if (t === 'request') loadLogs('request')
    else loadJobs()
  },
  { immediate: true },
)

onUnmounted(stopTail)
</script>

<template>
  <div class="logs-panel">
    <header class="logs-head">
      <h2>{{ t('logs.title') }}</h2>
      <p class="muted">{{ t('logs.subtitle') }}</p>
    </header>

    <nav class="logs-tabs">
      <button type="button" :class="{ active: tab === 'audit' }" @click="selectTab('audit')">{{ t('logs.tabs.audit') }}</button>
      <button type="button" :class="{ active: tab === 'request' }" @click="selectTab('request')">{{ t('logs.tabs.request') }}</button>
      <button type="button" :class="{ active: tab === 'jobs' }" @click="selectTab('jobs')">{{ t('logs.tabs.jobs') }}</button>
    </nav>

    <div v-if="error" class="err-banner">{{ error }}</div>

    <!-- Audit -->
    <table v-if="tab === 'audit'" class="logs-table">
      <thead>
        <tr><th>{{ t('logs.columns.time') }}</th><th>{{ t('logs.columns.op') }}</th><th>{{ t('logs.columns.entity') }}</th><th>{{ t('logs.columns.identifier') }}</th><th>{{ t('logs.columns.project') }}</th></tr>
      </thead>
      <tbody>
        <tr v-for="(e, i) in entries" :key="i">
          <td>{{ e.iso }}</td>
          <td>{{ e.op }}</td>
          <td>{{ e.entity }}</td>
          <td>{{ e.identifier }}</td>
          <td>{{ e.projectId || '—' }}</td>
        </tr>
        <tr v-if="!entries.length && !loading"><td colspan="5" class="muted">{{ t('logs.empty.log') }}</td></tr>
      </tbody>
    </table>

    <!-- Request -->
    <table v-else-if="tab === 'request'" class="logs-table">
      <thead>
        <tr><th>{{ t('logs.columns.time') }}</th><th>{{ t('logs.columns.method') }}</th><th>{{ t('logs.columns.path') }}</th><th>{{ t('logs.columns.status') }}</th><th>{{ t('logs.columns.ms') }}</th><th>{{ t('logs.columns.project') }}</th></tr>
      </thead>
      <tbody>
        <tr v-for="(e, i) in entries" :key="i" :class="{ 'row-err': e.status >= 400 }">
          <td>{{ e.iso }}</td>
          <td>{{ e.method }}</td>
          <td>{{ e.path }}</td>
          <td>{{ e.status }}</td>
          <td>{{ e.durationMs }}</td>
          <td>{{ e.projectId || '—' }}</td>
        </tr>
        <tr v-if="!entries.length && !loading"><td colspan="6" class="muted">{{ t('logs.empty.log') }}</td></tr>
      </tbody>
    </table>

    <!-- Jobs -->
    <div v-else class="jobs-layout">
      <aside class="jobs-list">
        <ul>
          <li
            v-for="j in jobs"
            :key="j.id"
            :class="{ active: j.id === selectedJobId }"
            @click="selectJob(j.id)"
          >
            <strong>{{ j.agentRef || j.id.slice(0, 8) }}</strong>
            <span class="muted">{{ j.metadata?.artifactName || j.id.slice(0, 8) }} · {{ j.status }}</span>
          </li>
          <li v-if="!jobs.length && !loading" class="muted">{{ t('logs.empty.job') }}</li>
        </ul>
      </aside>
      <section class="job-log">
        <div class="job-log-bar">
          <button type="button" class="btn" :disabled="!selectedJobId" @click="toggleTail">
            {{ tailing ? t('logs.jobs.tailStop') : t('logs.jobs.tailStart') }}
          </button>
          <span v-if="jobLogTruncated" class="muted">{{ t('logs.jobs.truncated') }}</span>
        </div>
        <pre v-if="selectedJobId">{{ jobLog || t('logs.jobs.logEmpty') }}</pre>
        <p v-else class="muted">{{ t('logs.jobs.selectPrompt') }}</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.logs-panel { padding: 1rem 1.25rem; max-width: 1100px; }
.logs-head h2 { margin: 0 0 0.25rem; font-size: 1.25rem; font-weight: 500; }
.muted { color: var(--text-muted, #666); font-size: 0.85rem; }
.logs-tabs { display: flex; gap: 0.25rem; margin: 0.75rem 0; border-bottom: 1px solid #ddd; }
.logs-tabs button {
  padding: 0.4rem 0.9rem; border: none; background: none; cursor: pointer;
  border-bottom: 2px solid transparent; font-size: 0.9rem;
}
.logs-tabs button.active { border-bottom-color: #1d9e75; color: #1d9e75; font-weight: 500; }
.logs-table { width: 100%; font-size: 0.82rem; border-collapse: collapse; }
.logs-table th, .logs-table td { text-align: left; padding: 0.3rem 0.5rem; border-bottom: 1px solid #eee; }
.logs-table .row-err td { color: #c00; }
.jobs-layout { display: grid; grid-template-columns: 200px 1fr; gap: 1rem; }
.jobs-list ul { list-style: none; padding: 0; margin: 0; }
.jobs-list li { padding: 0.4rem 0.5rem; border-radius: 6px; cursor: pointer; }
.jobs-list li.active { background: var(--gray-light, #f1efe8); }
.jobs-list li strong { display: block; font-size: 0.85rem; }
.job-log-bar { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem; }
.btn { padding: 0.3rem 0.7rem; border-radius: 6px; border: 1px solid #ccc; background: #fff; cursor: pointer; }
.job-log pre {
  background: #1e1e1e; color: #d4d4d4; padding: 0.75rem; border-radius: 6px;
  font-size: 0.78rem; max-height: 60vh; overflow: auto; white-space: pre-wrap;
}
.err-banner { background: #fee; padding: 0.5rem; border-radius: 6px; margin: 0.5rem 0; }
</style>
