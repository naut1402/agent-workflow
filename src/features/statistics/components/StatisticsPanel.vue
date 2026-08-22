<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { computed, onMounted, ref, watch } from 'vue'
import ChartCard from './ChartCard.vue'
import ChartSettingsDialog from './ChartSettingsDialog.vue'
import ChartTile from './ChartTile.vue'
import CSelect from '../../../core/ui/CSelect.vue'
import type { CSelectOption } from '../../../core/ui/CSelect.vue'
import { fetchUsageStats } from '../scripts/usageStatsApi'
import type { UsageGroupBy, UsageStatsResult } from '../schemas/usageStats'
import {
  makeDefaultChartConfig,
  sanitizeChartConfig,
  type ChartConfig,
} from '../lib/chartConfig'
import { formatDuration, formatNumber, formatTs } from '../lib/format'

/**
 * Mode Thống kê (issue #231): gallery chart 4 cột — mỗi chart một card
 * (ChartTile) với config riêng (groupBy/metric/loại/tiêu đề/span/height/định
 * dạng số/style) lưu localStorage. Card summary tách riêng khỏi bảng; bảng +
 * drill-down theo chart đang active (chart cuối được tương tác).
 */

const PREFS_KEY = 'dev-dashboard-statistics-prefs'
const DAY_MS = 86_400_000
const RANGE_OPTIONS = [7, 30, 90, 0] as const // 0 = tất cả
/** Giữ số cột trục X trong mức đọc được — dư gộp vào "(còn lại)". */
const MAX_CHART_ITEMS = 12

type Scope = 'project' | 'all'

const props = defineProps<{ projectId?: string | null; defaultProjectId?: string | null }>()

const { t } = useI18nHelpers()

// ── Config hiển thị (persist localStorage) ───────────────────────────────────
const scope = ref<Scope>('project')
const rangeDays = ref<number>(30)
const charts = ref<ChartConfig[]>([makeDefaultChartConfig()])

// ── Trạng thái runtime ───────────────────────────────────────────────────────
const results = ref<Record<string, UsageStatsResult>>({})
const activeChartId = ref('')
const settingsFor = ref('')
const loading = ref(false)
const error = ref('')
// Drill-down: project (scope all) → task → step; áp cho query của mọi chart.
const drillProject = ref('')
const drillTaskId = ref('')
const drillStepId = ref('')

function loadPrefs(): void {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return
    const p = JSON.parse(raw) as Record<string, unknown>
    if (p.scope === 'all' || p.scope === 'project') scope.value = p.scope
    if (typeof p.rangeDays === 'number' && (RANGE_OPTIONS as readonly number[]).includes(p.rangeDays)) {
      rangeDays.value = p.rangeDays
    }
    if (Array.isArray(p.charts) && p.charts.length) {
      const parsed = p.charts.map(sanitizeChartConfig).filter((c): c is ChartConfig => !!c)
      if (parsed.length) charts.value = parsed
    } else if (p.groupBy || p.metric || p.chartType || p.chart) {
      // Prefs bản đơn chart — migrate thành danh sách 1 phần tử.
      const legacy = sanitizeChartConfig({
        id: 'migrated',
        groupBy: p.groupBy,
        metric: p.metric,
        chartType: p.chartType,
        numberFormat: p.numberFormat,
        style: (p.chart as Record<string, unknown>) || {},
      })
      if (legacy) charts.value = [legacy]
    }
    if (!charts.value.some((c) => c.id === activeChartId.value)) {
      activeChartId.value = charts.value[0]?.id ?? ''
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
        rangeDays: rangeDays.value,
        charts: charts.value,
      }),
    )
  } catch {
    // localStorage đầy/bị chặn — prefs là best-effort.
  }
}

watch([scope, rangeDays], persistPrefs)
watch(charts, persistPrefs, { deep: true })

// ── Toolbar options ──────────────────────────────────────────────────────────
const scopeOptions = computed<CSelectOption[]>(() => [
  { value: 'project' as Scope, label: t('statistics.scope.project') },
  { value: 'all' as Scope, label: t('statistics.scope.all') },
])

/** Project param hiệu dụng: project đang chọn ở shell (null → default project,
 * cùng semantics với monitor), hoặc project đang drill khi scope all. */
const effectiveProject = computed(() =>
  scope.value === 'all' ? drillProject.value || '' : props.projectId || props.defaultProjectId || '',
)

// ── Chart đang active (bảng + drill-down theo chart này) ────────────────────
const activeChart = computed(
  () => charts.value.find((c) => c.id === activeChartId.value) ?? charts.value[0],
)

const activeResult = computed(() => (activeChart.value ? results.value[activeChart.value.id] : null))

const rows = computed(() => activeResult.value?.groups ?? [])

/** Định dạng số theo chart đang active (bảng + summary dùng chung). */
const activeNumberFormat = computed(() => activeChart.value?.numberFormat ?? 'compact')

function activateChart(id: string) {
  activeChartId.value = id
}

function openSettings(id: string) {
  activateChart(id)
  settingsFor.value = id
}

const editingChart = computed<ChartConfig | undefined>({
  get: () => charts.value.find((c) => c.id === settingsFor.value),
  set: (v) => {
    if (v) updateChart(v)
  },
})

function updateChart(next: ChartConfig) {
  const idx = charts.value.findIndex((c) => c.id === next.id)
  if (idx >= 0) charts.value[idx] = next
}

function addChart() {
  const chart = makeDefaultChartConfig()
  charts.value.push(chart)
  activateChart(chart.id)
  settingsFor.value = chart.id // mở luôn dialog để cấu hình chart mới
}

function removeChart(id: string) {
  if (charts.value.length <= 1) return
  charts.value = charts.value.filter((c) => c.id !== id)
  if (settingsFor.value === id) settingsFor.value = ''
  if (activeChartId.value === id) activeChartId.value = charts.value[0]?.id ?? ''
}

function onTileResize(chart: ChartConfig, span: number, height: number) {
  activateChart(chart.id)
  updateChart({ ...chart, span, style: { ...chart.style, height } })
}

// ── Data mỗi chart ───────────────────────────────────────────────────────────
function cardSeries(chart: ChartConfig): { labels: string[]; values: number[] } {
  const groups = results.value[chart.id]?.groups ?? []
  const labels = groups.map((g) => (g.key === '' ? t('statistics.noAttribution') : g.key))
  const values = groups.map((g) => g[chart.metric] ?? 0)
  if (groups.length <= MAX_CHART_ITEMS) return { labels, values }
  const rest = values.slice(MAX_CHART_ITEMS).reduce((sum, v) => sum + v, 0)
  return {
    labels: [...labels.slice(0, MAX_CHART_ITEMS), t('statistics.other')],
    values: [...values.slice(0, MAX_CHART_ITEMS), rest],
  }
}

// ── Card summary (min/max/avg — tách khỏi bảng) ──────────────────────────────
const entryStats = computed(() => activeResult.value?.totals ?? null)

/** Phân bố tổng token GIỮA các group (task nhẹ nhất/nặng nhất/trung bình). */
const groupSpread = computed(() => {
  if (!rows.value.length) return null
  const totals = rows.value.map((g) => g.totalTokens)
  const sum = totals.reduce((s, v) => s + v, 0)
  return { min: Math.min(...totals), max: Math.max(...totals), avg: sum / totals.length }
})

// ── Drill-down ───────────────────────────────────────────────────────────────
const drillable = computed(() => {
  const g = activeChart.value?.groupBy
  if (g === 'task' && !drillTaskId.value) return 'task' as const
  if (g === 'step' && !drillStepId.value) return 'step' as const
  if (g === 'project' && !drillProject.value) return 'project' as const
  return null
})

const breadcrumbs = computed(() => {
  const crumbs: { kind: 'project' | 'task' | 'step'; label: string; clear: () => void }[] = []
  if (drillProject.value) {
    crumbs.push({ kind: 'project', label: drillProject.value, clear: () => clearDrill('project') })
  }
  if (drillTaskId.value) {
    crumbs.push({ kind: 'task', label: drillTaskId.value, clear: () => clearDrill('task') })
  }
  if (drillStepId.value) {
    crumbs.push({ kind: 'step', label: drillStepId.value, clear: () => clearDrill('step') })
  }
  return crumbs
})

function setGroupByOfActive(groupBy: UsageGroupBy) {
  if (!activeChart.value) return
  updateChart({ ...activeChart.value, groupBy })
}

function drillTo(kind: 'project' | 'task' | 'step', key: string): void {
  if (kind === 'project') {
    drillProject.value = key
    setGroupByOfActive('task')
  } else if (kind === 'task') {
    drillTaskId.value = key
    setGroupByOfActive('step')
  } else {
    drillStepId.value = key
    setGroupByOfActive('job')
  }
}

/** Xoá drill ở bậc `kind` và mọi bậc dưới nó. */
function clearDrill(kind: 'project' | 'task' | 'step'): void {
  if (kind === 'project') {
    drillProject.value = ''
    drillTaskId.value = ''
    drillStepId.value = ''
    if (scope.value === 'all') setGroupByOfActive('project')
  } else if (kind === 'task') {
    drillTaskId.value = ''
    drillStepId.value = ''
    setGroupByOfActive('task')
  } else {
    drillStepId.value = ''
    setGroupByOfActive('step')
  }
}

function onRowClick(group: { key?: string }): void {
  if (!drillable.value) return
  const key = group.key
  if (!key) return
  drillTo(drillable.value, key)
}

// ── Load ─────────────────────────────────────────────────────────────────────
async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  const from =
    rangeDays.value > 0 ? new Date(Date.now() - rangeDays.value * DAY_MS).toISOString() : undefined
  try {
    const replies = await Promise.all(
      charts.value.map((chart) =>
        fetchUsageStats({
          project: effectiveProject.value || undefined,
          task: drillTaskId.value || undefined,
          step: drillStepId.value || undefined,
          from,
          groupBy: chart.groupBy,
        }).then((r) => [chart.id, r] as const),
      ),
    )
    results.value = Object.fromEntries(replies)
  } catch (e) {
    error.value = String((e as Error)?.message || e)
  } finally {
    loading.value = false
  }
}

// Reload khi query đổi: scope/project, drill, range, hoặc bộ groupBy của charts
// (đổi metric/title/style chỉ re-render, không refetch).
const groupBySignature = computed(() => charts.value.map((c) => `${c.id}:${c.groupBy}`).join('|'))
watch([effectiveProject, drillTaskId, drillStepId, rangeDays, groupBySignature], () => {
  void load()
})

// Scope hẹp lại trong khi chart đang group theo project → về task (option ẩn).
watch(scope, () => {
  if (scope.value === 'project') {
    for (const chart of charts.value) {
      if (chart.groupBy === 'project') updateChart({ ...chart, groupBy: 'task' })
    }
  }
})

onMounted(() => {
  loadPrefs()
  if (!activeChartId.value && charts.value[0]) activeChartId.value = charts.value[0].id
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
      <button
        type="button"
        class="icon-btn statistics-add-chart"
        :title="t('statistics.addChart')"
        :aria-label="t('statistics.addChart')"
        @click="addChart"
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            d="M8 3v10M3 8h10"
          />
        </svg>
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

    <!-- Card summary: min/max/avg per-entry + phân bố giữa các group -->
    <section v-if="activeResult" class="statistics-summary-card">
      <div class="summary-block">
        <span class="summary-block-title">{{ t('statistics.summary.overview') }}</span>
        <span class="summary-line">
          {{ t('statistics.summary.groups', { n: formatNumber(activeResult.totals.entries, activeNumberFormat) }) }}
          · {{ t('statistics.groupBy.' + (activeChart?.groupBy ?? 'task')) }}
        </span>
        <span class="summary-line">
          {{ t('statistics.totals.tokens') }}:
          <strong>{{ formatNumber(activeResult.totals.totalTokens, activeNumberFormat) }}</strong>
          · {{ t('statistics.totals.jobs') }}:
          <strong>{{ formatNumber(activeResult.totals.jobs, activeNumberFormat) }}</strong>
        </span>
      </div>
      <div v-if="entryStats" class="summary-block">
        <span class="summary-block-title">{{ t('statistics.summary.perEntry') }}</span>
        <span class="summary-line">
          {{ t('statistics.stats.minTokens') }}: <strong>{{ formatNumber(entryStats.minTotalTokens, activeNumberFormat) }}</strong>
          · {{ t('statistics.stats.maxTokens') }}: <strong>{{ formatNumber(entryStats.maxTotalTokens, activeNumberFormat) }}</strong>
          · {{ t('statistics.stats.avgTokens') }}: <strong>{{ formatNumber(entryStats.avgTotalTokens, activeNumberFormat) }}</strong>
        </span>
        <span class="summary-line">
          {{ t('statistics.stats.minDuration') }}: <strong>{{ formatDuration(entryStats.minDurationMs ?? 0) }}</strong>
          · {{ t('statistics.stats.maxDuration') }}: <strong>{{ formatDuration(entryStats.maxDurationMs ?? 0) }}</strong>
          · {{ t('statistics.stats.avgDuration') }}: <strong>{{ formatDuration(entryStats.avgDurationMs ?? 0) }}</strong>
        </span>
      </div>
      <div v-if="groupSpread" class="summary-block">
        <span class="summary-block-title">{{ t('statistics.summary.betweenGroups') }}</span>
        <span class="summary-line">
          {{ t('statistics.stats.minTokens') }}: <strong>{{ formatNumber(groupSpread.min, activeNumberFormat) }}</strong>
          · {{ t('statistics.stats.maxTokens') }}: <strong>{{ formatNumber(groupSpread.max, activeNumberFormat) }}</strong>
          · {{ t('statistics.stats.avgTokens') }}: <strong>{{ formatNumber(groupSpread.avg, activeNumberFormat) }}</strong>
        </span>
      </div>
    </section>

    <div class="statistics-charts">
      <ChartTile
        v-for="chart in charts"
        :key="chart.id"
        :span="chart.span"
        :height="chart.style.height"
        :removable="charts.length > 1"
        :class="{ 'is-active': chart.id === activeChart?.id }"
        @resize="(span, height) => onTileResize(chart, span, height)"
        @settings="openSettings(chart.id)"
        @remove="removeChart(chart.id)"
      >
        <ChartCard
          :title="chart.title"
          :chart-type="chart.chartType"
          :labels="cardSeries(chart).labels"
          :values="cardSeries(chart).values"
          :loading="loading"
          :number-format="chart.numberFormat"
          :style-config="chart.style"
        />
      </ChartTile>
    </div>

    <p v-if="activeResult?.truncated" class="muted statistics-truncated">
      {{ t('statistics.truncated') }}
    </p>

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
            <th class="num">{{ t('statistics.table.total') }}</th>
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
            <td class="num">{{ formatNumber(group.entries, activeNumberFormat) }}</td>
            <td class="num">{{ formatNumber(group.jobs, activeNumberFormat) }}</td>
            <td class="num">{{ formatNumber(group.inputTokens, activeNumberFormat) }}</td>
            <td class="num">{{ formatNumber(group.outputTokens, activeNumberFormat) }}</td>
            <td class="num">{{ formatNumber(group.cacheReadTokens, activeNumberFormat) }}</td>
            <td class="num">{{ formatNumber(group.cacheWriteTokens, activeNumberFormat) }}</td>
            <td class="num">{{ formatNumber(group.totalTokens, activeNumberFormat) }}</td>
            <td class="num">{{ formatDuration(group.durationMs) }}</td>
            <td class="num">{{ formatTs(group.lastTs) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="!loading && !error" class="muted">{{ t('statistics.emptyChart') }}</p>

    <ChartSettingsDialog
      v-if="editingChart"
      v-model="editingChart"
      :allow-project-group="!effectiveProject"
      @close="settingsFor = ''"
    />
  </div>
</template>

<style scoped lang="scss">
.statistics-panel {
  padding: 1rem 1.25rem;
  max-width: 1400px;
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
.statistics-add-chart {
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-muted);
}
.statistics-add-chart:hover {
  border-color: var(--accent);
  color: var(--accent);
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
/* Card summary — thông tin min/max/avg tách khỏi bảng. */
.statistics-summary-card {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.5rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  padding: 0.6rem 1rem;
  margin: 0.5rem 0 0.25rem;
}
.summary-block {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 14rem;
}
.summary-block-title {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.summary-line {
  font-size: 0.82rem;
  color: var(--text-muted);
}
.summary-line strong {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
/* Gallery 4 cột — tile mặc định span 2 (thuộc tính grid-column do ChartTile set). */
.statistics-charts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  align-items: start;
}
@media (max-width: 1100px) {
  .statistics-charts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.statistics-charts .chart-tile.is-active {
  border-color: var(--accent);
}
.statistics-truncated {
  margin: 0.5rem 0 0.25rem;
}
.statistics-table-wrap {
  flex: 1 1 auto;
  min-height: 10rem;
  max-height: min(60vh, calc(100vh - 18rem));
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  margin-top: 0.5rem;
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
