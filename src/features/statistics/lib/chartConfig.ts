import type { ChartKind, ChartStyleConfig } from './mermaidChart'
import { DEFAULT_CHART_STYLE } from './mermaidChart'
import type { NumberFormat } from './format'
import {
  USAGE_GROUP_BYS,
  USAGE_METRICS,
  type UsageGroupBy,
  type UsageMetric,
} from '../schemas/usageStats'

/** Grid span của chart tile trong gallery 4 cột. */
export const TILE_MIN_SPAN = 1
export const TILE_MAX_SPAN = 4

/** Config một chart instance trong danh sách chart của mode Thống kê. */
export interface ChartConfig {
  id: string
  /** Tiêu đề VẼ TRONG chart; rỗng → không vẽ. */
  title: string
  groupBy: UsageGroupBy
  metric: UsageMetric
  chartType: ChartKind
  /** Cột chiếm trong gallery (1-4). */
  span: number
  /** Định dạng số của riêng chart (K/M/B hay đầy đủ). */
  numberFormat: NumberFormat
  style: ChartStyleConfig
}

export function newChartId(): string {
  return `chart-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function makeDefaultChartConfig(overrides: Partial<ChartConfig> = {}): ChartConfig {
  return {
    id: newChartId(),
    title: '',
    groupBy: 'task',
    metric: 'totalTokens',
    chartType: 'bar',
    span: 2,
    numberFormat: 'compact',
    style: { ...DEFAULT_CHART_STYLE },
    ...overrides,
  }
}

const CHART_KINDS: ChartKind[] = ['bar', 'line', 'pie']

/**
 * Sanitize config đọc từ localStorage (prefs cũ/hỏng) — field lệch thì bỏ,
 * trả về config hợp lệ; object không salvage được → null.
 */
export function sanitizeChartConfig(raw: unknown): ChartConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  const groupBy = isGroupBy(p.groupBy) ? p.groupBy : 'task'
  const metric = isMetric(p.metric) ? p.metric : 'totalTokens'
  const chartType = CHART_KINDS.includes(p.chartType as ChartKind)
    ? (p.chartType as ChartKind)
    : 'bar'
  return {
    id: typeof p.id === 'string' && p.id ? p.id : newChartId(),
    title: typeof p.title === 'string' ? p.title : '',
    groupBy,
    metric,
    chartType,
    span: clampSpan(p.span),
    numberFormat: p.numberFormat === 'full' ? 'full' : 'compact',
    style: { ...DEFAULT_CHART_STYLE, ...(isStyleObject(p.style) ? p.style : {}) },
  }
}

function isStyleObject(v: unknown): v is Partial<ChartStyleConfig> {
  return !!v && typeof v === 'object'
}

function clampSpan(v: unknown): number {
  const n = typeof v === 'number' ? v : 2
  return Math.min(TILE_MAX_SPAN, Math.max(TILE_MIN_SPAN, Math.round(n)))
}

function isGroupBy(v: unknown): v is UsageGroupBy {
  return typeof v === 'string' && (USAGE_GROUP_BYS as readonly string[]).includes(v)
}

function isMetric(v: unknown): v is UsageMetric {
  return typeof v === 'string' && (USAGE_METRICS as readonly string[]).includes(v)
}
