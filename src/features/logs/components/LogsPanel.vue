<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import type { LogEntry, LogLevel } from '../../../core/log/schema'
import { fetchLogs, fetchJobLog } from '../scripts/LogsPanelApi'
import { fetchJobs } from '../../runner/scripts/runnerApi'
import { fetchLoggingConfig } from '../../settings/scripts/SettingsDialogApi'
import { useLogsTable } from '../composables/useLogsTable'

const { t } = useI18nHelpers()

type Tab = 'audit' | 'request' | 'events' | 'jobs'

const enabledTypes = ref({ audit: true, request: true, events: true, jobs: true })
const availableTabs = computed(() => {
  const tabs: Tab[] = []
  if (enabledTypes.value.audit) tabs.push('audit')
  if (enabledTypes.value.request) tabs.push('request')
  if (enabledTypes.value.events) tabs.push('events')
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

function onHeaderSort(key: string, ev: MouseEvent) {
  toggleSort(key, { append: ev.shiftKey })
}

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
      events: types.events !== false,
      jobs: types.jobs !== false,
    }
  } catch {
    enabledTypes.value = { audit: true, request: true, events: true, jobs: true }
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
      events: detail.types.events !== false,
      jobs: detail.types.jobs !== false,
    }
    const tabs = availableTabs.value
    if (!tabs.includes(tab.value)) tab.value = tabs[0] || 'audit'
  } else {
    void loadLoggingTypes()
  }
}

async function loadLogs(type: 'audit' | 'request' | 'events') {
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

function payloadPreview(entry: LogEntry): string {
  if (entry.type !== 'events') return ''
  try {
    return JSON.stringify(entry.payload ?? {})
  } catch {
    return ''
  }
}

const copyFlash = ref('')
let copyFlashTimer: ReturnType<typeof setTimeout> | null = null

async function copyText(text: string) {
  const value = String(text ?? '')
  if (!value) return
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
    } else {
      const ta = document.createElement('textarea')
      ta.value = value
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    copyFlash.value = t('logs.copy.done')
  } catch {
    copyFlash.value = t('logs.copy.fail')
  }
  if (copyFlashTimer) clearTimeout(copyFlashTimer)
  copyFlashTimer = setTimeout(() => {
    copyFlash.value = ''
  }, 1500)
}

// React to tab changes (covers both programmatic and click-driven switches).
watch(
  tab,
  (t) => {
    if (t === 'audit') loadLogs('audit')
    else if (t === 'request') loadLogs('request')
    else if (t === 'events') loadLogs('events')
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
  if (copyFlashTimer) clearTimeout(copyFlashTimer)
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
        v-if="enabledTypes.events"
        type="button"
        :class="{ active: tab === 'events' }"
        @click="selectTab('events')"
      >
        {{ t('logs.tabs.events') }}
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
    <p v-if="copyFlash" class="copy-flash" role="status">{{ copyFlash }}</p>

    <div
      v-if="tab === 'audit' || tab === 'request' || tab === 'events'"
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
    <div v-if="tab === 'audit' && enabledTypes.audit" class="logs-table-wrap">
    <table class="logs-table">
      <thead>
        <tr>
          <th class="sortable" :title="t('logs.filters.sortHint')" @click="onHeaderSort('time', $event)">
            {{ t('logs.columns.time') }} {{ sortIndicator('time') }}
          </th>
          <th class="sortable" :title="t('logs.filters.sortHint')" @click="onHeaderSort('level', $event)">
            {{ t('logs.columns.level') }} {{ sortIndicator('level') }}
          </th>
          <th class="sortable" :title="t('logs.filters.sortHint')" @click="onHeaderSort('traceId', $event)">
            {{ t('logs.columns.traceId') }} {{ sortIndicator('traceId') }}
          </th>
          <th class="sortable" :title="t('logs.filters.sortHint')" @click="onHeaderSort('op', $event)">
            {{ t('logs.columns.op') }} {{ sortIndicator('op') }}
          </th>
          <th class="sortable" :title="t('logs.filters.sortHint')" @click="onHeaderSort('entity', $event)">
            {{ t('logs.columns.entity') }} {{ sortIndicator('entity') }}
          </th>
          <th class="sortable" :title="t('logs.filters.sortHint')" @click="onHeaderSort('identifier', $event)">
            {{ t('logs.columns.identifier') }} {{ sortIndicator('identifier') }}
          </th>
          <th class="sortable" :title="t('logs.filters.sortHint')" @click="onHeaderSort('project', $event)">
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
    </div>

    <!-- Request -->
    <div v-else-if="tab === 'request' && enabledTypes.request" class="logs-table-wrap">
    <table class="logs-table logs-table-request">
      <thead>
        <tr>
          <th class="sortable" :title="t('logs.filters.sortHint')" @click="onHeaderSort('time', $event)">
            {{ t('logs.columns.time') }} {{ sortIndicator('time') }}
          </th>
          <th class="sortable" :title="t('logs.filters.sortHint')" @click="onHeaderSort('level', $event)">
            {{ t('logs.columns.level') }} {{ sortIndicator('level') }}
          </th>
          <th class="sortable" :title="t('logs.filters.sortHint')" @click="onHeaderSort('traceId', $event)">
            {{ t('logs.columns.traceId') }} {{ sortIndicator('traceId') }}
          </th>
          <th class="sortable" :title="t('logs.filters.sortHint')" @click="onHeaderSort('method', $event)">
            {{ t('logs.columns.method') }} {{ sortIndicator('method') }}
          </th>
          <th class="sortable" :title="t('logs.filters.sortHint')" @click="onHeaderSort('path', $event)">
            {{ t('logs.columns.path') }} {{ sortIndicator('path') }}
          </th>
          <th class="sortable" :title="t('logs.filters.sortHint')" @click="onHeaderSort('query', $event)">
            {{ t('logs.columns.query') }} {{ sortIndicator('query') }}
          </th>
          <th class="sortable" :title="t('logs.filters.sortHint')" @click="onHeaderSort('response', $event)">
            {{ t('logs.columns.response') }} {{ sortIndicator('response') }}
          </th>
          <th class="sortable" :title="t('logs.filters.sortHint')" @click="onHeaderSort('status', $event)">
            {{ t('logs.columns.status') }} {{ sortIndicator('status') }}
          </th>
          <th class="sortable" :title="t('logs.filters.sortHint')" @click="onHeaderSort('ms', $event)">
            {{ t('logs.columns.ms') }} {{ sortIndicator('ms') }}
          </th>
          <th class="sortable" :title="t('logs.filters.sortHint')" @click="onHeaderSort('project', $event)">
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
          <td class="cell-clip">
            <button
              v-if="e.type === 'request' && e.query"
              type="button"
              class="clip-btn"
              :title="`${t('logs.copy.hint')}\n${e.query}`"
              @click="copyText(e.query)"
            >
              {{ e.query }}
            </button>
            <span v-else class="muted">—</span>
          </td>
          <td class="cell-clip">
            <button
              v-if="e.type === 'request' && e.response"
              type="button"
              class="clip-btn"
              :title="`${t('logs.copy.hint')}\n${e.response}`"
              @click="copyText(e.response)"
            >
              {{ e.response }}
            </button>
            <span v-else class="muted">—</span>
          </td>
          <td>{{ e.type === 'request' ? e.status : '' }}</td>
          <td>{{ e.type === 'request' ? e.durationMs : '' }}</td>
          <td>{{ e.projectId || '—' }}</td>
        </tr>
        <tr v-if="!displayed.length && !loading">
          <td colspan="10" class="muted">{{ t('logs.empty.log') }}</td>
        </tr>
      </tbody>
    </table>
    </div>

    <!-- Events (domain bus JSONL) -->
    <div v-else-if="tab === 'events' && enabledTypes.events" class="logs-table-wrap">
    <table class="logs-table logs-table-events">
      <thead>
        <tr>
          <th class="sortable" :title="t('logs.filters.sortHint')" @click="onHeaderSort('time', $event)">
            {{ t('logs.columns.time') }} {{ sortIndicator('time') }}
          </th>
          <th class="sortable" :title="t('logs.filters.sortHint')" @click="onHeaderSort('level', $event)">
            {{ t('logs.columns.level') }} {{ sortIndicator('level') }}
          </th>
          <th class="sortable" :title="t('logs.filters.sortHint')" @click="onHeaderSort('traceId', $event)">
            {{ t('logs.columns.traceId') }} {{ sortIndicator('traceId') }}
          </th>
          <th class="sortable" :title="t('logs.filters.sortHint')" @click="onHeaderSort('event', $event)">
            {{ t('logs.columns.event') }} {{ sortIndicator('event') }}
          </th>
          <th class="sortable" :title="t('logs.filters.sortHint')" @click="onHeaderSort('project', $event)">
            {{ t('logs.columns.project') }} {{ sortIndicator('project') }}
          </th>
          <th class="sortable" :title="t('logs.filters.sortHint')" @click="onHeaderSort('payload', $event)">
            {{ t('logs.columns.payload') }} {{ sortIndicator('payload') }}
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
          <td>{{ e.type === 'events' ? e.event : '' }}</td>
          <td>{{ e.projectId || '—' }}</td>
          <td class="cell-clip">
            <button
              v-if="e.type === 'events' && payloadPreview(e)"
              type="button"
              class="clip-btn"
              :title="`${t('logs.copy.hint')}\n${payloadPreview(e)}`"
              @click="copyText(payloadPreview(e))"
            >
              {{ payloadPreview(e) }}
            </button>
            <span v-else class="muted">—</span>
          </td>
        </tr>
        <tr v-if="!displayed.length && !loading">
          <td colspan="6" class="muted">{{ t('logs.empty.log') }}</td>
        </tr>
      </tbody>
    </table>
    </div>

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
.logs-panel {
  padding: 1rem 1.25rem;
  max-width: 1200px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  box-sizing: border-box;
}
.logs-head h2 { margin: 0 0 0.25rem; font-size: 1.25rem; font-weight: 500; }
.muted { color: var(--text-muted); font-size: 0.85rem; }
.logs-tabs {
  display: flex;
  gap: 0.25rem;
  margin: 0.75rem 0;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
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
.logs-table-wrap {
  flex: 1 1 auto;
  min-height: 12rem;
  max-height: min(70vh, calc(100vh - 14rem));
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
}
.logs-table { width: 100%; font-size: 0.82rem; border-collapse: separate; border-spacing: 0; }
.logs-table th,
.logs-table td {
  text-align: left;
  padding: 0.35rem 0.75rem;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}
.logs-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--panel);
  box-shadow: 0 1px 0 var(--border);
}
/* Time vs level: give ISO timestamp room and gap before level badge */
.logs-table th:nth-child(1),
.logs-table td:nth-child(1) {
  min-width: 12.5rem;
  width: 12.5rem;
  white-space: nowrap;
  padding-right: 1.25rem;
}
.logs-table th:nth-child(2),
.logs-table td:nth-child(2) {
  min-width: 5rem;
  width: 5rem;
  padding-left: 0.35rem;
  padding-right: 0.85rem;
}
.logs-table th.sortable {
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.logs-table th.sortable:hover { color: var(--accent); }
.logs-table .row-err td { color: var(--danger); }
.logs-table-request { table-layout: fixed; }
.logs-table-request th:nth-child(6),
.logs-table-request td:nth-child(6) { width: 14%; }
.logs-table-request th:nth-child(7),
.logs-table-request td:nth-child(7) { width: 22%; }
.cell-clip {
  max-width: 12rem;
  overflow: hidden;
}
.clip-btn {
  display: block;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: none;
  background: none;
  padding: 0;
  margin: 0;
  text-align: left;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.clip-btn:hover { color: var(--accent); text-decoration: underline; }
.copy-flash {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  color: var(--accent);
}
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
