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

/** Bước snap chiều cao khi kéo resize (px) — align tương tự snap cột. */
export const TILE_HEIGHT_STEP = 20

export type ChartKind = 'bar' | 'pie' | 'line'

/**
 * Thuộc tính hiển thị của chart — những gì renderer hiện tại (chart.js) hỗ
 * trợ: chiều cao (width bám panel), nhãn trục, màu. Title là tham số riêng
 * (rỗng → không vẽ).
 */
export interface ChartStyleConfig {
  height: number
  /** Tiêu đề trục x (bar/line); rỗng → không thêm. */
  xAxisTitle?: string
  /** Nhãn trục y (bar/line); rỗng → không thêm. */
  yAxisLabel?: string
  /** Màu bar/line (hex). */
  color?: string
  /** Bảng màu section pie (hex). */
  pieColors?: string[]
}

export const DEFAULT_CHART_STYLE: ChartStyleConfig = {
  height: 300,
  xAxisTitle: '',
  yAxisLabel: '',
  color: '#4A7DFF',
  pieColors: [
    '#4A7DFF',
    '#FF9F43',
    '#2ECC71',
    '#E74C3C',
    '#9B59B6',
    '#1ABC9C',
    '#F1C40F',
    '#E67E22',
    '#34495E',
    '#FF6E00',
  ],
}

/** Giới hạn chiều cao chart (px) — width bám panel. */
export const CHART_MIN_HEIGHT = 180
export const CHART_MAX_HEIGHT = 3000

export function clampChartHeight(height: number): number {
  return Math.min(CHART_MAX_HEIGHT, Math.max(CHART_MIN_HEIGHT, Math.round(height)))
}

/** Snapped height theo TILE_HEIGHT_STEP, trong khoảng clamp. */
export function snapChartHeight(height: number): number {
  const stepped = Math.round(height / TILE_HEIGHT_STEP) * TILE_HEIGHT_STEP
  return clampChartHeight(stepped)
}

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
