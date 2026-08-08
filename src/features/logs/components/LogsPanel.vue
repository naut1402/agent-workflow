<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import type { LogEntry, LogLevel } from '../../../core/log/schema'
import { fetchLogs, fetchJobLog } from '../scripts/LogsPanelApi'
import { fetchJobs } from '../../runner/scripts/runnerApi'
import { fetchLoggingConfig } from '../../settings/scripts/SettingsDialogApi'
import { useLogsTable } from '../composables/useLogsTable'

const { t } = useI18nHelpers()

type Tab = 'audit' | 'request' | 'jobs'

const enabledTypes = ref({ audit: true, request: true, jobs: true })
const availableTabs = computed(() => {
  const tabs: Tab[] = []
  if (enabledTypes.value.audit) tabs.push('audit')
  if (enabledTypes.value.request) tabs.push('request')
  if (enabledTypes.value.jobs) tabs.push('jobs')
  return tabs
})

const tab = ref<Tab>('audit')
const entries = ref<LogEntry[]>([])
const jobs = ref<any[]>([])
const selectedJobId = ref('')
const jobLog = ref('')
const jobLogTruncated = ref(false)
const tailing = ref(false)
const loading = ref(false)
const error = ref('')

const {
  filters,
  displayed,
  toggleSort,
  sortIndicator,
  setLevelFilter,
  clearFilters,
  LOG_LEVELS,
} = useLogsTable(entries)

let tailTimer: ReturnType<typeof setInterval> | null = null

function stopTail() {
  if (tailTimer) {
    clearInterval(tailTimer)
    tailTimer = null
  }
  tailing.value = false
}

async function loadLoggingTypes() {
  try {
    const data = await fetchLoggingConfig()
    const types = data.config?.types || {}
    enabledTypes.value = {
      audit: types.audit !== false,
      request: types.request !== false,
      jobs: types.jobs !== false,
    }
  } catch {
    enabledTypes.value = { audit: true, request: true, jobs: true }
  }
  const tabs = availableTabs.value
  if (!tabs.includes(tab.value)) {
    tab.value = tabs[0] || 'audit'
  }
}

function onLoggingChanged(ev: Event) {
  const detail = (ev as CustomEvent).detail
  if (detail?.types) {
    enabledTypes.value = {
      audit: detail.types.audit !== false,
      request: detail.types.request !== false,
      jobs: detail.types.jobs !== false,
    }
    const tabs = availableTabs.value
    if (!tabs.includes(tab.value)) tab.value = tabs[0] || 'audit'
  } else {
    void loadLoggingTypes()
  }
}

async function loadLogs(type: 'audit' | 'request') {
  loading.value = true
  error.value = ''
  try {
    const data = await fetchLogs({ type, limit: 200 })
    if (tab.value !== type) return
    entries.value = (data.entries || []) as LogEntry[]
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

function filterByTrace(traceId: string) {
  if (!traceId) return
  filters.value = { ...filters.value, traceId }
}

function levelActive(level: LogLevel): boolean {
  return filters.value.levels.includes(level)
}

// React to tab changes (covers both programmatic and click-driven switches).
watch(
  tab,
  (t) => {
    if (t === 'audit') loadLogs('audit')
    else if (t === 'request') loadLogs('request')
    else if (t === 'jobs') loadJobs()
  },
  { immediate: true },
)

onMounted(() => {
  void loadLoggingTypes()
  window.addEventListener('dev-dashboard:logging-changed', onLoggingChanged)
})

onUnmounted(() => {
  stopTail()
  window.removeEventListener('dev-dashboard:logging-changed', onLoggingChanged)
})
</script>

<template>
  <div class="logs-panel">
    <header class="logs-head">
      <h2>{{ t('logs.title') }}</h2>
      <p class="muted">{{ t('logs.subtitle') }}</p>
    </header>

    <nav v-if="availableTabs.length" class="logs-tabs">
      <button
        v-if="enabledTypes.audit"
        type="button"
        :class="{ active: tab === 'audit' }"
        @click="selectTab('audit')"
      >
        {{ t('logs.tabs.audit') }}
      </button>
      <button
        v-if="enabledTypes.request"
        type="button"
        :class="{ active: tab === 'request' }"
        @click="selectTab('request')"
      >
        {{ t('logs.tabs.request') }}
      </button>
      <button
        v-if="enabledTypes.jobs"
        type="button"
        :class="{ active: tab === 'jobs' }"
        @click="selectTab('jobs')"
      >
        {{ t('logs.tabs.jobs') }}
      </button>
    </nav>
    <p v-else class="muted">{{ t('logs.empty.allDisabled') }}</p>

    <div v-if="error" class="err-banner">{{ error }}</div>

    <div
      v-if="tab === 'audit' || tab === 'request'"
      class="logs-toolbar"
    >
      <input
        v-model="filters.q"
        type="search"
        class="logs-filter-input"
        :placeholder="t('logs.filters.q')"
        autocomplete="off"
      />
      <input
        v-model="filters.traceId"
        type="search"
        class="logs-filter-input logs-filter-trace"
        :placeholder="t('logs.filters.traceId')"
        autocomplete="off"
      />
      <div class="logs-level-filters" role="group" :aria-label="t('logs.filters.level')">
        <button
          type="button"
          class="level-chip"
          :class="{ active: !filters.levels.length }"
          @click="setLevelFilter('all')"
        >
          {{ t('logs.filters.levelAll') }}
        </button>
        <button
          v-for="lv in LOG_LEVELS"
          :key="lv"
          type="button"
          class="level-chip"
          :class="[`level-${lv}`, { active: levelActive(lv) }]"
          @click="setLevelFilter(lv)"
        >
          {{ lv }}
        </button>
      </div>
      <button type="button" class="btn btn-ghost" @click="clearFilters">
        {{ t('logs.filters.clear') }}
      </button>
      <span class="muted logs-count">{{ displayed.length }}/{{ entries.length }}</span>
    </div>

    <!-- Audit -->
    <table v-if="tab === 'audit' && enabledTypes.audit" class="logs-table">
      <thead>
        <tr>
          <th class="sortable" @click="toggleSort('time')">
            {{ t('logs.columns.time') }} {{ sortIndicator('time') }}
          </th>
          <th class="sortable" @click="toggleSort('level')">
            {{ t('logs.columns.level') }} {{ sortIndicator('level') }}
          </th>
          <th class="sortable" @click="toggleSort('traceId')">
            {{ t('logs.columns.traceId') }} {{ sortIndicator('traceId') }}
          </th>
          <th class="sortable" @click="toggleSort('op')">
            {{ t('logs.columns.op') }} {{ sortIndicator('op') }}
          </th>
          <th class="sortable" @click="toggleSort('entity')">
            {{ t('logs.columns.entity') }} {{ sortIndicator('entity') }}
          </th>
          <th class="sortable" @click="toggleSort('identifier')">
            {{ t('logs.columns.identifier') }} {{ sortIndicator('identifier') }}
          </th>
          <th class="sortable" @click="toggleSort('project')">
            {{ t('logs.columns.project') }} {{ sortIndicator('project') }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(e, i) in displayed" :key="i" :class="[`row-level-${e.level}`]">
          <td>{{ e.iso }}</td>
          <td><span class="level-badge" :class="`level-${e.level}`">{{ e.level }}</span></td>
          <td>
            <button
              v-if="e.traceId"
              type="button"
              class="trace-link"
              :title="t('logs.filters.useTrace')"
              @click="filterByTrace(e.traceId)"
            >
              {{ e.traceId.slice(0, 8) }}…
            </button>
            <span v-else class="muted">—</span>
          </td>
          <td>{{ e.type === 'audit' ? e.op : '' }}</td>
          <td>{{ e.type === 'audit' ? e.entity : '' }}</td>
          <td>{{ e.type === 'audit' ? e.identifier : '' }}</td>
          <td>{{ e.projectId || '—' }}</td>
        </tr>
        <tr v-if="!displayed.length && !loading">
          <td colspan="7" class="muted">{{ t('logs.empty.log') }}</td>
        </tr>
      </tbody>
    </table>

    <!-- Request -->
    <table v-else-if="tab === 'request' && enabledTypes.request" class="logs-table">
      <thead>
        <tr>
          <th class="sortable" @click="toggleSort('time')">
            {{ t('logs.columns.time') }} {{ sortIndicator('time') }}
          </th>
          <th class="sortable" @click="toggleSort('level')">
            {{ t('logs.columns.level') }} {{ sortIndicator('level') }}
          </th>
          <th class="sortable" @click="toggleSort('traceId')">
            {{ t('logs.columns.traceId') }} {{ sortIndicator('traceId') }}
          </th>
          <th class="sortable" @click="toggleSort('method')">
            {{ t('logs.columns.method') }} {{ sortIndicator('method') }}
          </th>
          <th class="sortable" @click="toggleSort('path')">
            {{ t('logs.columns.path') }} {{ sortIndicator('path') }}
          </th>
          <th class="sortable" @click="toggleSort('status')">
            {{ t('logs.columns.status') }} {{ sortIndicator('status') }}
          </th>
          <th class="sortable" @click="toggleSort('ms')">
            {{ t('logs.columns.ms') }} {{ sortIndicator('ms') }}
          </th>
          <th class="sortable" @click="toggleSort('project')">
            {{ t('logs.columns.project') }} {{ sortIndicator('project') }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(e, i) in displayed"
          :key="i"
          :class="{ 'row-err': e.type === 'request' && e.status >= 400, [`row-level-${e.level}`]: true }"
        >
          <td>{{ e.iso }}</td>
          <td><span class="level-badge" :class="`level-${e.level}`">{{ e.level }}</span></td>
          <td>
            <button
              v-if="e.traceId"
              type="button"
              class="trace-link"
              :title="t('logs.filters.useTrace')"
              @click="filterByTrace(e.traceId)"
            >
              {{ e.traceId.slice(0, 8) }}…
            </button>
            <span v-else class="muted">—</span>
          </td>
          <td>{{ e.type === 'request' ? e.method : '' }}</td>
          <td>{{ e.type === 'request' ? e.path : '' }}</td>
          <td>{{ e.type === 'request' ? e.status : '' }}</td>
          <td>{{ e.type === 'request' ? e.durationMs : '' }}</td>
          <td>{{ e.projectId || '—' }}</td>
        </tr>
        <tr v-if="!displayed.length && !loading">
          <td colspan="8" class="muted">{{ t('logs.empty.log') }}</td>
        </tr>
      </tbody>
    </table>

    <!-- Jobs -->
    <div v-else-if="tab === 'jobs' && enabledTypes.jobs" class="jobs-layout">
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

<style scoped lang="scss">
.logs-panel { padding: 1rem 1.25rem; max-width: 1200px; }
.logs-head h2 { margin: 0 0 0.25rem; font-size: 1.25rem; font-weight: 500; }
.muted { color: var(--text-muted); font-size: 0.85rem; }
.logs-tabs {
  display: flex;
  gap: 0.25rem;
  margin: 0.75rem 0;
  border-bottom: 1px solid var(--border);
}
.logs-tabs button {
  padding: 0.4rem 0.9rem;
  border: none;
  background: none;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  font-size: 0.9rem;
  color: var(--muted);
}
.logs-tabs button.active {
  border-bottom-color: var(--accent);
  color: var(--accent);
  font-weight: 500;
}
.logs-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin: 0.5rem 0 0.75rem;
}
.logs-filter-input {
  min-width: 10rem;
  flex: 1 1 8rem;
  padding: 0.35rem 0.55rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  font-size: 0.82rem;
}
.logs-filter-trace { flex: 1 1 12rem; font-family: ui-monospace, monospace; }
.logs-level-filters { display: flex; flex-wrap: wrap; gap: 0.25rem; }
.level-chip {
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text-muted);
  font-size: 0.75rem;
  cursor: pointer;
  text-transform: uppercase;
}
.level-chip.active {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}
.logs-count { margin-left: auto; }
.logs-table { width: 100%; font-size: 0.82rem; border-collapse: collapse; }
.logs-table th,
.logs-table td {
  text-align: left;
  padding: 0.3rem 0.5rem;
  border-bottom: 1px solid var(--border);
}
.logs-table th.sortable {
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.logs-table th.sortable:hover { color: var(--accent); }
.logs-table .row-err td { color: var(--danger); }
.level-badge {
  display: inline-block;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  font-size: 0.72rem;
  text-transform: uppercase;
  font-weight: 600;
  border: 1px solid var(--border);
}
.level-badge.level-debug { color: var(--text-muted); }
.level-badge.level-info { color: var(--accent); }
.level-badge.level-warn { color: #b45309; }
.level-badge.level-error { color: var(--danger); }
.trace-link {
  border: none;
  background: none;
  padding: 0;
  color: var(--accent);
  cursor: pointer;
  font-family: ui-monospace, monospace;
  font-size: 0.78rem;
  text-decoration: underline;
}
.btn {
  padding: 0.3rem 0.7rem;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
}
.btn-ghost { background: transparent; }
.jobs-layout { display: grid; grid-template-columns: 200px 1fr; gap: 1rem; }
.jobs-list ul { list-style: none; padding: 0; margin: 0; }
.jobs-list li { padding: 0.4rem 0.5rem; border-radius: 6px; cursor: pointer; }
.jobs-list li.active { background: var(--panel-2); }
.jobs-list li strong { display: block; font-size: 0.85rem; }
.job-log-bar { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem; }
.job-log pre {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 0.75rem;
  border-radius: 6px;
  font-size: 0.78rem;
  max-height: 60vh;
  overflow: auto;
  white-space: pre-wrap;
}
.err-banner {
  background: var(--panel-2);
  color: var(--danger);
  border: 1px solid var(--danger);
  padding: 0.5rem;
  border-radius: 6px;
  margin: 0.5rem 0;
}
</style>
