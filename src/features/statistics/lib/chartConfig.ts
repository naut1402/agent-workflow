import type { ChartKind, ChartStyleConfig } from './mermaidChart'
import { DEFAULT_CHART_STYLE } from './mermaidChart'
import {
  USAGE_GROUP_BYS,
  USAGE_METRICS,
  type UsageGroupBy,
  type UsageMetric,
} from '../schemas/usageStats'

/** Config một chart instance trong danh sách chart của mode Thống kê. */
export interface ChartConfig {
  id: string
  /** Tiêu đề VẼ TRONG chart; rỗng → không vẽ. */
  title: string
  groupBy: UsageGroupBy
  metric: UsageMetric
  chartType: ChartKind
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
    style: { ...DEFAULT_CHART_STYLE, ...(isStyleObject(p.style) ? p.style : {}) },
  }
}

function isStyleObject(v: unknown): v is Partial<ChartStyleConfig> {
  return !!v && typeof v === 'object'
}

function isGroupBy(v: unknown): v is UsageGroupBy {
  return typeof v === 'string' && (USAGE_GROUP_BYS as readonly string[]).includes(v)
}

function isMetric(v: unknown): v is UsageMetric {
  return typeof v === 'string' && (USAGE_METRICS as readonly string[]).includes(v)
}
