<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { computed, onMounted, ref, watch } from 'vue'
import ChartCard from './ChartCard.vue'
import ChartSettingsDialog from './ChartSettingsDialog.vue'
import CSelect from '../../../core/ui/CSelect.vue'
import { fetchUsageStats } from '../scripts/usageStatsApi'
import {
  USAGE_GROUP_BYS,
  USAGE_METRICS,
  type UsageGroupBy,
  type UsageMetric,
  type UsageStatsResult,
} from '../schemas/usageStats'
import type { CSelectOption } from '../../../core/ui/CSelect.vue'
import { compactNumber, formatDuration, formatTs } from '../lib/format'
import type { ChartKind, ChartStyleConfig } from '../lib/mermaidChart'
import { DEFAULT_CHART_STYLE } from '../lib/mermaidChart'

/**
 * Mode Thống kê (issue #231): tổng hợp token usage theo project → task → step
 * → job (+ model/provider/source/date), chart qua ChartCard (mermaid P0) và
 * bảng drill-down. Prefs hiển thị lưu localStorage.
 */

const PREFS_KEY = 'dev-dashboard-statistics-prefs'
const DAY_MS = 86_400_000
const RANGE_OPTIONS = [7, 30, 90, 0] as const // 0 = tất cả

type Scope = 'project' | 'all'

const props = defineProps<{ projectId?: string | null; defaultProjectId?: string | null }>()

const { t } = useI18nHelpers()

const scope = ref<Scope>('project')
const metric = ref<UsageMetric>('totalTokens')
const groupBy = ref<UsageGroupBy>('task')
const chartType = ref<ChartKind>('bar')
const rangeDays = ref<number>(30)
const chartStyle = ref<ChartStyleConfig>({ ...DEFAULT_CHART_STYLE })
const settingsOpen = ref(false)
// Drill-down: project (scope all) → task → step; groupBy tự hạ cấp theo bậc.
const drillProject = ref('')
const drillTaskId = ref('')
const drillStepId = ref('')

const result = ref<UsageStatsResult | null>(null)
const loading = ref(false)
const error = ref('')

function isGroupBy(v: unknown): v is UsageGroupBy {
  return typeof v === 'string' && (USAGE_GROUP_BYS as readonly string[]).includes(v)
}

function isMetric(v: unknown): v is UsageMetric {
  return typeof v === 'string' && (USAGE_METRICS as readonly string[]).includes(v)
}

function loadPrefs(): void {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return
    const p = JSON.parse(raw) as Record<string, unknown>
    if (p.scope === 'all' || p.scope === 'project') scope.value = p.scope
    if (isMetric(p.metric)) metric.value = p.metric
    if (isGroupBy(p.groupBy)) groupBy.value = p.groupBy
    if (p.chartType === 'bar' || p.chartType === 'line' || p.chartType === 'pie') {
      chartType.value = p.chartType
    }
    if (typeof p.rangeDays === 'number' && (RANGE_OPTIONS as readonly number[]).includes(p.rangeDays)) {
      rangeDays.value = p.rangeDays
    }
    // Merge với default — prefs cũ không có key chart thì vẫn đủ field.
    if (p.chart && typeof p.chart === 'object') {
      chartStyle.value = { ...DEFAULT_CHART_STYLE, ...(p.chart as Partial<ChartStyleConfig>) }
    }
  } catch {
    // Prefs hỏng → giữ default, không throw.
  }
}

function persistPrefs(): void {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        scope: scope.value,
        metric: metric.value,
        groupBy: groupBy.value,
        chartType: chartType.value,
        rangeDays: rangeDays.value,
        chart: chartStyle.value,
      }),
    )
  } catch {
    // localStorage đầy/bị chặn — prefs là best-effort.
  }
}

watch([scope, metric, groupBy, chartType, rangeDays], persistPrefs, { deep: false })
watch(chartStyle, persistPrefs, { deep: true })

/** Handle kéo góc chart → cập nhật kích thước (áp qua directive config). */
function onChartResize(width: number, height: number) {
  chartStyle.value = { ...chartStyle.value, width, height }
}

/** Group theo project chỉ có nghĩa khi xem tất cả project. */
const groupByOptions = computed<CSelectOption[]>(() => {
  const opts: CSelectOption[] = []
  for (const g of USAGE_GROUP_BYS) {
    if (g === 'project' && effectiveProject.value) continue
    opts.push({ value: g, label: t(`statistics.groupBy.${g}`) })
  }
  return opts
})

const metricOptions = computed<CSelectOption[]>(() =>
  USAGE_METRICS.map((m) => ({ value: m, label: t(`statistics.metric.${m}`) })),
)

const chartTypeOptions = computed<CSelectOption[]>(() =>
  (['bar', 'line', 'pie'] as ChartKind[]).map((c) => ({
    value: c,
    label: t(`statistics.chartType.${c}`),
  })),
)

const scopeOptions = computed<CSelectOption[]>(() => [
  { value: 'project' as Scope, label: t('statistics.scope.project') },
  { value: 'all' as Scope, label: t('statistics.scope.all') },
])

/**
 * Project param hiệu dụng: project đang chọn ở shell (null → default project,
 * cùng semantics với monitor), hoặc project đang drill khi scope all.
 */
const effectiveProject = computed(() =>
  scope.value === 'all'
    ? drillProject.value || ''
    : props.projectId || props.defaultProjectId || '',
)

const rows = computed(() => result.value?.groups ?? [])

const chartLabels = computed(() => chartData.value.labels)

const chartValues = computed(() => chartData.value.values)

/** Pie N slice là vô dụng — top 10 + gộp phần còn lại theo metric đang xem. */
const PIE_TOP = 10

const chartData = computed<{ labels: string[]; values: number[] }>(() => {
  const labels = rows.value.map((g) => (g.key === '' ? t('statistics.noAttribution') : g.key))
  const values = rows.value.map((g) => g[metric.value] ?? 0)
  if (chartType.value !== 'pie' || rows.value.length <= PIE_TOP) return { labels, values }
  const rest = values.slice(PIE_TOP).reduce((sum, v) => sum + v, 0)
  return {
    labels: [...labels.slice(0, PIE_TOP), t('statistics.other')],
    values: [...values.slice(PIE_TOP), rest],
  }
})

/** Row nào drill được tiếp cấp dưới. */
const drillable = computed(() => {
  if (groupBy.value === 'task' && !drillTaskId.value) return 'task' as const
  if (groupBy.value === 'step' && !drillStepId.value) return 'step' as const
  if (groupBy.value === 'project' && !drillProject.value) return 'project' as const
  return null
})

const breadcrumbs = computed(() => {
  const crumbs: { kind: 'project' | 'task' | 'step'; label: string; clear: () => void }[] = []
  if (drillProject.value) {
    crumbs.push({
      kind: 'project',
      label: drillProject.value,
      clear: () => clearDrill('project'),
    })
  }
  if (drillTaskId.value) {
    crumbs.push({ kind: 'task', label: drillTaskId.value, clear: () => clearDrill('task') })
  }
  if (drillStepId.value) {
    crumbs.push({ kind: 'step', label: drillStepId.value, clear: () => clearDrill('step') })
  }
  return crumbs
})

function drillTo(kind: 'project' | 'task' | 'step', key: string): void {
  if (kind === 'project') {
    drillProject.value = key
    groupBy.value = 'task'
  } else if (kind === 'task') {
    drillTaskId.value = key
    groupBy.value = 'step'
  } else {
    drillStepId.value = key
    groupBy.value = 'job'
  }
}

/** Xoá drill ở bậc `kind` và mọi bậc dưới nó. */
function clearDrill(kind: 'project' | 'task' | 'step'): void {
  if (kind === 'project') {
    drillProject.value = ''
    drillTaskId.value = ''
    drillStepId.value = ''
    if (scope.value === 'all') groupBy.value = 'project'
  } else if (kind === 'task') {
    drillTaskId.value = ''
    drillStepId.value = ''
    groupBy.value = 'task'
  } else {
    drillStepId.value = ''
    groupBy.value = 'step'
  }
}

function onRowClick(group: { key?: string }): void {
  if (!drillable.value) return
  const key = group.key
  if (!key) return
  drillTo(drillable.value, key)
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    result.value = await fetchUsageStats({
      project: effectiveProject.value || undefined,
      task: drillTaskId.value || undefined,
      step: drillStepId.value || undefined,
      from:
        rangeDays.value > 0
          ? new Date(Date.now() - rangeDays.value * DAY_MS).toISOString()
          : undefined,
      groupBy: groupBy.value,
    })
  } catch (e) {
    error.value = String((e as Error)?.message || e)
  } finally {
    loading.value = false
  }
}

// Scope hẹp lại trong khi đang group theo project → về task (option đã ẩn).
watch(scope, () => {
  if (scope.value === 'project' && groupBy.value === 'project') groupBy.value = 'task'
})

watch(
  [effectiveProject, drillTaskId, drillStepId, groupBy, rangeDays],
  () => {
    void load()
  },
)

onMounted(() => {
  loadPrefs()
  void load()
})
</script>

<template>
  <div class="statistics-panel">
    <header class="statistics-head">
      <h2>{{ t('statistics.title') }}</h2>
      <p class="muted">{{ t('statistics.subtitle') }}</p>
    </header>

    <div v-if="error" class="err-banner">{{ error }}</div>

    <div class="statistics-toolbar">
      <div class="statistics-field">
        <span class="statistics-field-label">{{ t('statistics.scope.label') }}</span>
        <CSelect
          v-model="scope"
          :options="scopeOptions"
          :aria-label="t('statistics.scope.label')"
          class="statistics-select"
        />
      </div>
      <div class="statistics-field">
        <span class="statistics-field-label">{{ t('statistics.groupBy.label') }}</span>
        <CSelect
          v-model="groupBy"
          :options="groupByOptions"
          :aria-label="t('statistics.groupBy.label')"
          class="statistics-select"
        />
      </div>
      <div class="statistics-range" role="group" :aria-label="t('statistics.range.label')">
        <button
          v-for="d in RANGE_OPTIONS"
          :key="d"
          type="button"
          class="statistics-range-btn"
          :class="{ active: rangeDays === d }"
          @click="rangeDays = d"
        >
          {{ d === 0 ? t('statistics.range.all') : t('statistics.range.days', { n: d }) }}
        </button>
      </div>
      <button type="button" class="statistics-refresh" @click="load">
        {{ t('statistics.refresh') }}
      </button>
    </div>

    <nav v-if="breadcrumbs.length" class="statistics-breadcrumbs" :aria-label="t('statistics.drill.label')">
      <button
        v-for="crumb in breadcrumbs"
        :key="crumb.kind"
        type="button"
        class="statistics-crumb"
        :title="t('statistics.drill.clear')"
        @click="crumb.clear()"
      >
        <span class="statistics-crumb-kind">{{ t(`statistics.drill.${crumb.kind}`) }}</span>
        <span class="statistics-crumb-label">{{ crumb.label }}</span>
        <span class="statistics-crumb-x" aria-hidden="true">✕</span>
      </button>
    </nav>

    <ChartCard
      :title="t('statistics.chartTitle', { metric: t(`statistics.metric.${metric}`), dimension: t(`statistics.groupBy.${groupBy}`) })"
      :chart-type="chartType"
      :labels="chartLabels"
      :values="chartValues"
      :value-label="t(`statistics.metric.${metric}`)"
      :loading="loading"
      :style-config="chartStyle"
      @resize="onChartResize"
    >
      <template #control>
        <div class="statistics-chart-controls">
          <CSelect
            v-model="metric"
            :options="metricOptions"
            :aria-label="t('statistics.metric.label')"
            class="statistics-select statistics-select--control"
          />
          <CSelect
            v-model="chartType"
            :options="chartTypeOptions"
            :aria-label="t('statistics.chartType.label')"
            class="statistics-select statistics-select--control"
          />
          <button
            type="button"
            class="icon-btn statistics-settings-btn"
            :title="t('statistics.settings.open')"
            :aria-label="t('statistics.settings.open')"
            @click="settingsOpen = true"
          >
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
              <circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.3" />
              <path
                fill="none"
                stroke="currentColor"
                stroke-width="1.3"
                stroke-linecap="round"
                d="M8 2.2v1.4M8 12.4v1.4M2.2 8h1.4M12.4 8h1.4M3.9 3.9l1 1M11.1 11.1l1 1M3.9 12.1l1-1M11.1 4.9l1-1"
              />
            </svg>
          </button>
        </div>
      </template>
    </ChartCard>

    <ChartSettingsDialog v-if="settingsOpen" v-model="chartStyle" :chart-type="chartType" @close="settingsOpen = false" />

    <p v-if="result?.truncated" class="muted statistics-truncated">
      {{ t('statistics.truncated') }}
    </p>

    <div v-if="result" class="statistics-summary">
      <span>{{ t('statistics.totals.entries') }}: <strong>{{ result.totals.entries }}</strong></span>
      <span>{{ t('statistics.totals.jobs') }}: <strong>{{ result.totals.jobs }}</strong></span>
      <span>
        {{ t('statistics.totals.tokens') }}:
        <strong>{{ compactNumber(result.totals.totalTokens) }}</strong>
      </span>
      <span>
        {{ t('statistics.totals.duration') }}:
        <strong>{{ formatDuration(result.totals.durationMs) }}</strong>
      </span>
    </div>

    <div v-if="rows.length" class="statistics-table-wrap">
      <table class="statistics-table">
        <thead>
          <tr>
            <th>{{ t('statistics.table.key') }}</th>
            <th class="num">{{ t('statistics.table.entries') }}</th>
            <th class="num">{{ t('statistics.table.jobs') }}</th>
            <th class="num">{{ t('statistics.table.input') }}</th>
            <th class="num">{{ t('statistics.table.output') }}</th>
            <th class="num">{{ t('statistics.table.cacheRead') }}</th>
            <th class="num">{{ t('statistics.table.cacheWrite') }}</th>
            <th class="num" :class="{ 'is-metric': metric === 'totalTokens' }">
              {{ t('statistics.table.total') }}
            </th>
            <th class="num">{{ t('statistics.table.duration') }}</th>
            <th class="num">{{ t('statistics.table.lastTs') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="group in rows"
            :key="group.key"
            :class="{ 'is-drillable': !!drillable && group.key !== '' }"
            :title="drillable && group.key !== '' ? t('statistics.table.drillHint') : undefined"
            @click="onRowClick(group)"
          >
            <td class="statistics-key">
              {{ group.key === '' ? t('statistics.noAttribution') : group.key }}
            </td>
            <td class="num">{{ group.entries }}</td>
            <td class="num">{{ group.jobs }}</td>
            <td class="num">{{ compactNumber(group.inputTokens) }}</td>
            <td class="num">{{ compactNumber(group.outputTokens) }}</td>
            <td class="num" :class="{ 'is-metric': metric === 'cacheReadTokens' }">
              {{ compactNumber(group.cacheReadTokens) }}
            </td>
            <td class="num" :class="{ 'is-metric': metric === 'cacheWriteTokens' }">
              {{ compactNumber(group.cacheWriteTokens) }}
            </td>
            <td class="num" :class="{ 'is-metric': metric === 'totalTokens' }">
              {{ compactNumber(group.totalTokens) }}
            </td>
            <td class="num">{{ formatDuration(group.durationMs) }}</td>
            <td class="num">{{ formatTs(group.lastTs) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="!loading && !error" class="muted">{{ t('statistics.emptyChart') }}</p>
  </div>
</template>

<style scoped lang="scss">
.statistics-panel {
  padding: 1rem 1.25rem;
  max-width: 1200px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  box-sizing: border-box;
  /* Shell `.main-editor` overflow:hidden — panel tự scroll toàn trang
     (header + chart + bảng vượt viewport thì cuộn dọc ở đây). */
  overflow-y: auto;
}
.statistics-head h2 {
  margin: 0 0 0.25rem;
  font-size: 1.25rem;
  font-weight: 500;
}
.muted {
  color: var(--text-muted);
  font-size: 0.85rem;
}
.err-banner {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--danger);
  border-radius: 6px;
  color: var(--danger);
  font-size: 0.85rem;
  margin: 0.5rem 0;
}
.statistics-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: flex-end;
  margin: 0.75rem 0 0.25rem;
}
.statistics-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.statistics-field-label {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.statistics-select {
  width: 13rem;
  max-width: 60vw;
}
.statistics-select--control {
  width: 10rem;
}
.statistics-range {
  display: flex;
  gap: 0.25rem;
  align-items: center;
}
.statistics-range-btn {
  padding: 0.3rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel);
  color: var(--text-muted);
  font-size: 0.78rem;
  cursor: pointer;
}
.statistics-range-btn.active {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}
.statistics-refresh {
  margin-left: auto;
  padding: 0.4rem 0.9rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  font-size: 0.85rem;
  cursor: pointer;
}
.statistics-refresh:hover {
  border-color: var(--accent);
}
.statistics-breadcrumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0.35rem 0 0;
}
.statistics-crumb {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.25rem 0.6rem;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--accent-dim);
  color: var(--accent);
  font-size: 0.78rem;
  cursor: pointer;
  max-width: 22rem;
}
.statistics-crumb-kind {
  font-weight: 600;
  text-transform: uppercase;
  font-size: 0.66rem;
}
.statistics-crumb-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.statistics-crumb-x {
  opacity: 0.7;
}
.statistics-chart-controls {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  align-items: center;
}
.statistics-settings-btn {
  flex-shrink: 0;
}
.statistics-truncated {
  margin: 0 0 0.25rem;
}
.statistics-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 1.25rem;
  font-size: 0.85rem;
  color: var(--text-muted);
  margin: 0.25rem 0 0.5rem;
}
.statistics-summary strong {
  color: var(--text);
}
.statistics-table-wrap {
  flex: 1 1 auto;
  min-height: 10rem;
  max-height: min(60vh, calc(100vh - 18rem));
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
}
.statistics-table {
  width: 100%;
  font-size: 0.82rem;
  border-collapse: separate;
  border-spacing: 0;
}
.statistics-table th,
.statistics-table td {
  text-align: left;
  padding: 0.35rem 0.75rem;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
  white-space: nowrap;
}
.statistics-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--panel);
  box-shadow: 0 1px 0 var(--border);
  color: var(--text-muted);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.statistics-table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.statistics-table .is-metric {
  color: var(--accent);
  font-weight: 600;
}
.statistics-key {
  font-family: ui-monospace, monospace;
  max-width: 18rem;
  overflow: hidden;
  text-overflow: ellipsis;
}
.statistics-table tbody tr.is-drillable {
  cursor: pointer;
}
.statistics-table tbody tr.is-drillable:hover {
  background: var(--hover-surface);
}
</style>
