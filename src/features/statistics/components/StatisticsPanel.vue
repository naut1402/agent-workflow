<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ChartCard from './ChartCard.vue'
import ChartSettingsDialog from './ChartSettingsDialog.vue'
import ChartTile from './ChartTile.vue'
import ReportCard from './ReportCard.vue'
import CSelect from '../../../core/ui/CSelect.vue'
import type { CSelectOption } from '../../../core/ui/CSelect.vue'
import { fetchUsageStats } from '../scripts/usageStatsApi'
import {
  USAGE_METRICS,
  type UsageGroupBy,
  type UsageMetric,
  type UsageStatsResult,
} from '../schemas/usageStats'
import {
  makeDefaultChartConfig,
  sanitizeChartConfig,
  snapChartHeight,
  TILE_MAX_SPAN,
  TILE_MIN_SPAN,
  type ChartConfig,
} from '../lib/chartConfig'
import { formatDuration, formatNumber, formatTs, signedNumber } from '../lib/format'

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

/** Card summary co giãn chiều cao như chart tile (snap bước 20px). */
const summaryHeight = ref(200)
/** Card summary co giãn chiều rộng theo grid span (1-4 cột). */
const summarySpan = ref(4)

function loadPrefs(): void {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return
    const p = JSON.parse(raw) as Record<string, unknown>
    if (p.scope === 'all' || p.scope === 'project') scope.value = p.scope
    if (typeof p.rangeDays === 'number' && (RANGE_OPTIONS as readonly number[]).includes(p.rangeDays)) {
      rangeDays.value = p.rangeDays
    }
    if (typeof p.summaryHeight === 'number' && p.summaryHeight >= 120) {
      summaryHeight.value = snapChartHeight(p.summaryHeight)
    }
    if (typeof p.summarySpan === 'number') {
      summarySpan.value = Math.min(TILE_MAX_SPAN, Math.max(TILE_MIN_SPAN, Math.round(p.summarySpan)))
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
        summaryHeight: summaryHeight.value,
        summarySpan: summarySpan.value,
        charts: charts.value,
      }),
    )
  } catch {
    // localStorage đầy/bị chặn — prefs là best-effort.
  }
}

watch([scope, rangeDays, summaryHeight, summarySpan], persistPrefs)
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

/** Menu thêm thẻ: biểu đồ hoặc report xếp hạng. */
const addMenuOpen = ref(false)

function addCard(kind: 'chart' | 'report') {
  addMenuOpen.value = false
  const chart = makeDefaultChartConfig({ kind, span: kind === 'report' ? 1 : 2 })
  charts.value.push(chart)
  activateChart(chart.id)
  settingsFor.value = chart.id // mở luôn dialog để cấu hình thẻ mới
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
/** Series cho biểu đồ — cap 12 item + gộp còn lại để trục không dồn. */
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

/** Series cho report — đầy đủ, ReportCard tự cắt top-N. */
function reportSeries(chart: ChartConfig): { labels: string[]; values: number[] } {
  const groups = results.value[chart.id]?.groups ?? []
  return {
    labels: groups.map((g) => (g.key === '' ? t('statistics.noAttribution') : g.key)),
    values: groups.map((g) => g[chart.metric] ?? 0),
  }
}

// ── Bảng chi tiết: lọc theo tên + offset ±avg ngay trong cột ────────────────
const tableFilter = ref('')

const filteredRows = computed(() => {
  const q = tableFilter.value.trim().toLowerCase()
  if (!q) return rows.value
  return rows.value.filter((g) => g.key.toLowerCase().includes(q))
})

/** Trung bình MỖI CỘT token trên các dòng đang hiển thị (đã lọc). */
const columnAvgs = computed(() => {
  const metrics = USAGE_METRICS as readonly UsageMetric[]
  const out = {} as Record<UsageMetric, number>
  for (const m of metrics) {
    const total = filteredRows.value.reduce((s, g) => s + (g[m] ?? 0), 0)
    out[m] = filteredRows.value.length ? total / filteredRows.value.length : 0
  }
  return out
})

function offsetClass(offset: number): string {
  if (offset > 0.5) return 'is-above'
  if (offset < -0.5) return 'is-below'
  return 'is-avg'
}

// ── Card summary (min/max/avg — table, co giãn được) ─────────────────────────
const entryStats = computed(() => activeResult.value?.totals ?? null)

/** spread min/max/avg từ danh sách giá trị (null khi rỗng). */
function spreadOf(values: number[]): { min: number; max: number; avg: number } | null {
  if (!values.length) return null
  const sum = values.reduce((s, v) => s + v, 0)
  return { min: Math.min(...values), max: Math.max(...values), avg: sum / values.length }
}

/** min/max/avg MỖI METRIC (input/output/cache/total) giữa các group đang xem. */
const metricSpreads = computed(() =>
  USAGE_METRICS.map((metric) => ({
    metric,
    spread: spreadOf(filteredRows.value.map((g) => g[metric] ?? 0)),
  })),
)

/** Tổng token mỗi step — query summary riêng, luôn có bất kể chart nào. */
const stepSpread = computed(() => spreadOf((stepSummary.value?.groups ?? []).map((g) => g.totalTokens)))

/** Card summary co giãn cả CHIỀU RỘNG (grid span) LẪN chiều cao — như tile. */
const summaryDragPreview = ref<{ span: number; height: number } | null>(null)
const summaryRef = ref<HTMLElement | null>(null)
const summaryHandleRef = ref<HTMLElement | null>(null)
const summaryGridRef = ref<HTMLElement | null>(null)
let stopSummaryDrag: (() => void) | null = null

const GRID_GAP = 12

function summaryGridColumnWidth(): number {
  const grid = summaryGridRef.value
  if (!grid) return 240
  return Math.max(80, (grid.clientWidth - 3 * GRID_GAP) / 4)
}

function onSummaryResizeStart(down: PointerEvent) {
  const handle = summaryHandleRef.value
  if (!handle || stopSummaryDrag) return
  const colWidth = summaryGridColumnWidth()
  const start = {
    x: down.clientX,
    y: down.clientY,
    span: summarySpan.value,
    height: summaryHeight.value,
    width: colWidth * summarySpan.value + GRID_GAP * (summarySpan.value - 1),
  }
  try {
    handle.setPointerCapture?.(down.pointerId)
  } catch {
    // PointerId tổng hợp có thể bị từ chối — window listener là nguồn sự thật.
  }
  const onMove = (move: PointerEvent) => {
    const desiredWidth = start.width + (move.clientX - start.x)
    const span = Math.max(
      TILE_MIN_SPAN,
      Math.min(TILE_MAX_SPAN, Math.round((desiredWidth + GRID_GAP) / (colWidth + GRID_GAP))),
    )
    summaryDragPreview.value = {
      span,
      height: snapChartHeight(start.height + (move.clientY - start.y)),
    }
  }
  const onUp = () => {
    stopSummaryDrag?.()
    const final = summaryDragPreview.value
    summaryDragPreview.value = null
    if (final) {
      summarySpan.value = final.span
      summaryHeight.value = final.height
    }
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
  stopSummaryDrag = () => {
    stopSummaryDrag = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
  }
}

onBeforeUnmount(() => {
  stopSummaryDrag?.()
})

const summaryStyle = computed(() => ({
  gridColumn: `span ${summaryDragPreview.value?.span ?? summarySpan.value} / span ${
    summaryDragPreview.value?.span ?? summarySpan.value
  }`,
  height: `${summaryDragPreview.value?.height ?? summaryHeight.value}px`,
}))

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

/** Offset thời lượng so với avg: "+1h 2m" / "−30s" / "±0". */
function signedDuration(offsetMs: number): string {
  if (!Number.isFinite(offsetMs) || Math.abs(offsetMs) < 500) return '±0'
  return `${offsetMs > 0 ? '+' : '−'}${formatDuration(Math.abs(offsetMs))}`
}

// ── Load ─────────────────────────────────────────────────────────────────────
/** Summary token theo step — query riêng, độc lập groupBy của các chart. */
const stepSummary = ref<UsageStatsResult | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  const from =
    rangeDays.value > 0 ? new Date(Date.now() - rangeDays.value * DAY_MS).toISOString() : undefined
  const query = {
    project: effectiveProject.value || undefined,
    task: drillTaskId.value || undefined,
    step: drillStepId.value || undefined,
    from,
  }
  try {
    // Fetch step summary trước, charts sau — test dùng lastUrl() vẫn trúng chart cuối.
    const [stepRes, ...replies] = await Promise.all([
      fetchUsageStats({ ...query, groupBy: 'step' }).catch(() => null),
      ...charts.value.map((chart) =>
        fetchUsageStats({ ...query, groupBy: chart.groupBy }).then((r) => [chart.id, r] as const),
      ),
    ])
    stepSummary.value = stepRes
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
      <div class="statistics-add-wrap">
        <button
          type="button"
          class="icon-btn statistics-add-chart"
          :title="t('statistics.addCard')"
          :aria-label="t('statistics.addCard')"
          :aria-expanded="addMenuOpen"
          @click="addMenuOpen = !addMenuOpen"
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
        <div v-if="addMenuOpen" class="statistics-add-menu" role="menu">
          <button type="button" role="menuitem" @click="addCard('chart')">
            📊 {{ t('statistics.kind.chart') }}
          </button>
          <button type="button" role="menuitem" @click="addCard('report')">
            🏆 {{ t('statistics.kind.report') }}
          </button>
        </div>
      </div>
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

    <!-- Card summary: table min/max/avg — co giãn rộng (grid span) + cao như tile -->
    <div v-if="activeResult" ref="summaryGridRef" class="statistics-summary-grid">
      <section ref="summaryRef" class="statistics-summary-card" :style="summaryStyle">
        <header class="summary-card-head">
          <h3>📋 {{ t('statistics.summary.title') }}</h3>
          <span class="muted">
            {{ t('statistics.summary.overviewLine', {
              entries: formatNumber(activeResult.totals.entries, activeNumberFormat),
              dimension: t('statistics.groupBy.' + (activeChart?.groupBy ?? 'task')),
              tokens: formatNumber(activeResult.totals.totalTokens, activeNumberFormat),
              jobs: formatNumber(activeResult.totals.jobs, activeNumberFormat),
            }) }}
          </span>
        </header>
        <div class="summary-card-body">
          <table class="summary-table">
            <thead>
              <tr>
                <th>{{ t('statistics.summary.colMetric') }}</th>
                <th class="num">🟢 {{ t('statistics.summary.colMin') }}</th>
                <th class="num">🔵 {{ t('statistics.summary.colAvg') }}</th>
                <th class="num">🔴 {{ t('statistics.summary.colMax') }}</th>
              </tr>
            </thead>
            <tbody>
              <!-- Mỗi metric token: spread giữa các group của dimension đang xem -->
              <tr v-for="row in metricSpreads" v-show="row.spread" :key="row.metric">
                <td class="summary-metric">
                  🧩 {{ t('statistics.summary.rowMetric', {
                    metric: t(`statistics.metric.${row.metric}`),
                    dimension: t('statistics.groupBy.' + (activeChart?.groupBy ?? 'task')),
                  }) }}
                </td>
                <td class="num is-below">{{ formatNumber(row.spread?.min ?? 0, activeNumberFormat) }}</td>
                <td class="num is-avg">{{ formatNumber(row.spread?.avg ?? 0, activeNumberFormat) }}</td>
                <td class="num is-above">{{ formatNumber(row.spread?.max ?? 0, activeNumberFormat) }}</td>
              </tr>
              <tr v-if="entryStats">
                <td class="summary-metric">
                  🧮 {{ t('statistics.summary.rowEntryTokens') }}
                  <span class="summary-hint">{{ t('statistics.summary.entryHint') }}</span>
                </td>
                <td class="num is-below">{{ formatNumber(entryStats.minTotalTokens, activeNumberFormat) }}</td>
                <td class="num is-avg">{{ formatNumber(entryStats.avgTotalTokens, activeNumberFormat) }}</td>
                <td class="num is-above">{{ formatNumber(entryStats.maxTotalTokens, activeNumberFormat) }}</td>
              </tr>
              <tr v-if="entryStats">
                <td class="summary-metric">⏱️ {{ t('statistics.summary.rowEntryDuration') }}</td>
                <td class="num is-below">{{ formatDuration(entryStats.minDurationMs ?? 0) }}</td>
                <td class="num is-avg">{{ formatDuration(entryStats.avgDurationMs ?? 0) }}</td>
                <td class="num is-above">{{ formatDuration(entryStats.maxDurationMs ?? 0) }}</td>
              </tr>
              <tr v-if="stepSpread">
                <td class="summary-metric">🪜 {{ t('statistics.summary.rowStepTokens') }}</td>
                <td class="num is-below">{{ formatNumber(stepSpread.min, activeNumberFormat) }}</td>
                <td class="num is-avg">{{ formatNumber(stepSpread.avg, activeNumberFormat) }}</td>
                <td class="num is-above">{{ formatNumber(stepSpread.max, activeNumberFormat) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <span
          ref="summaryHandleRef"
          class="summary-resize-handle"
          role="separator"
          :title="t('statistics.settings.resizeHint')"
          @pointerdown="onSummaryResizeStart"
        />
      </section>
    </div>

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
        <ReportCard
          v-if="chart.kind === 'report'"
          :labels="reportSeries(chart).labels"
          :values="reportSeries(chart).values"
          :top-n="chart.topN"
          :direction="chart.reportDirection"
          :number-format="chart.numberFormat"
          :metric-label="t(`statistics.metric.${chart.metric}`)"
          :loading="loading"
        />
        <ChartCard
          v-else
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
      <div class="statistics-table-toolbar">
        <input
          v-model="tableFilter"
          type="search"
          class="statistics-table-search"
          :placeholder="t('statistics.table.searchPlaceholder')"
          autocomplete="off"
        />
        <span class="muted">
          {{ t('statistics.table.shown', { shown: filteredRows.length, total: rows.length }) }}
        </span>
      </div>
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
            v-for="group in filteredRows"
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
            <td class="num">
              {{ formatNumber(group.inputTokens, activeNumberFormat) }}
              <span class="offset" :class="offsetClass(group.inputTokens - columnAvgs.inputTokens)">{{ signedNumber(group.inputTokens - columnAvgs.inputTokens, activeNumberFormat) }}</span>
            </td>
            <td class="num">
              {{ formatNumber(group.outputTokens, activeNumberFormat) }}
              <span class="offset" :class="offsetClass(group.outputTokens - columnAvgs.outputTokens)">{{ signedNumber(group.outputTokens - columnAvgs.outputTokens, activeNumberFormat) }}</span>
            </td>
            <td class="num">
              {{ formatNumber(group.cacheReadTokens, activeNumberFormat) }}
              <span class="offset" :class="offsetClass(group.cacheReadTokens - columnAvgs.cacheReadTokens)">{{ signedNumber(group.cacheReadTokens - columnAvgs.cacheReadTokens, activeNumberFormat) }}</span>
            </td>
            <td class="num">
              {{ formatNumber(group.cacheWriteTokens, activeNumberFormat) }}
              <span class="offset" :class="offsetClass(group.cacheWriteTokens - columnAvgs.cacheWriteTokens)">{{ signedNumber(group.cacheWriteTokens - columnAvgs.cacheWriteTokens, activeNumberFormat) }}</span>
            </td>
            <td class="num">
              {{ formatNumber(group.totalTokens, activeNumberFormat) }}
              <span class="offset" :class="offsetClass(group.totalTokens - columnAvgs.totalTokens)">{{ signedNumber(group.totalTokens - columnAvgs.totalTokens, activeNumberFormat) }}</span>
            </td>
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
.statistics-add-wrap {
  position: relative;
}
.statistics-add-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  min-width: 13rem;
  padding: 4px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
}
.statistics-add-menu button {
  padding: 0.45rem 0.7rem;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text);
  font-size: 0.85rem;
  text-align: left;
  cursor: pointer;
}
.statistics-add-menu button:hover {
  background: var(--hover-surface);
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
/* Card summary — grid 4 cột riêng để co giãn CHIỀU RỘNG theo span như tile. */
.statistics-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 0.5rem 0 0.25rem;
}
@media (max-width: 1100px) {
  .statistics-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
/* Card summary — table min/max/avg, co giãn chiều cao như chart tile. */
.statistics-summary-card {
  position: relative;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  padding: 0.5rem 1rem 0.75rem;
  margin: 0.5rem 0 0.25rem;
  display: flex;
  flex-direction: column;
  min-height: 120px;
  overflow: hidden;
}
.summary-card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem 1rem;
  flex-shrink: 0;
}
.summary-card-head h3 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 500;
}
.summary-card-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
.summary-table {
  width: 100%;
  font-size: 0.82rem;
  border-collapse: collapse;
}
.summary-table th,
.summary-table td {
  padding: 0.3rem 0.6rem;
  border-bottom: 1px solid var(--border);
  text-align: left;
  white-space: nowrap;
}
.summary-table th {
  color: var(--text-muted);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.summary-table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.summary-metric {
  color: var(--text);
}
.summary-hint {
  display: block;
  color: var(--text-muted);
  font-size: 0.72rem;
  font-weight: 400;
}
.summary-resize-handle {
  position: absolute;
  right: 2px;
  bottom: 2px;
  z-index: 2;
  width: 14px;
  height: 14px;
  cursor: ns-resize;
  border-right: 3px solid var(--muted);
  border-bottom: 3px solid var(--muted);
  border-bottom-right-radius: 3px;
  opacity: 0.65;
  touch-action: none;
}
.summary-resize-handle:hover {
  opacity: 1;
  border-color: var(--accent);
}
/* Màu highlight: dưới avg (xanh) / avg (accent) / trên avg (đỏ cam). */
.statistics-table .is-below,
.summary-table .is-below {
  color: #2ecc71;
}
.statistics-table .is-avg,
.summary-table .is-avg {
  color: var(--accent);
}
.statistics-table .is-above,
.summary-table .is-above {
  color: #ff8c69;
}
.statistics-table .offset {
  display: inline-block;
  margin-left: 0.3rem;
  font-size: 0.72rem;
  font-weight: 500;
  opacity: 0.85;
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
.statistics-table-toolbar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.4rem 0.6rem;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
}
.statistics-table-search {
  flex: 0 1 16rem;
  padding: 0.3rem 0.55rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--input-surface);
  color: var(--text);
  font-size: 0.82rem;
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
