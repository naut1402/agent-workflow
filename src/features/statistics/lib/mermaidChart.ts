/**
 * Builder mermaid definition (pie / xychart-beta) cho thống kê usage — pure,
 * không đụng DOM, test được bằng vitest không cần render mermaid thật.
 *
 * ChartCard nhận data + config và tự build định nghĩa qua module này; khi đổi
 * renderer (chart.js, …) chỉ sửa bên trong wrapper (issue #231 quyết định 1).
 */

export type ChartKind = 'bar' | 'pie' | 'line'

/** Label biểu đồ tối đa chừng này ký tự — dài hơn thì cắt, tránh tràn trục. */
const LABEL_MAX_CHARS = 28

/**
 * Thuộc tính hiển thị của chart — chỉ gồm những gì mermaid hiện tại render
 * được qua directive frontmatter: kích thước (xyChart.width/height), màu
 * (plotColorPalette / pie1..N). Thuộc tính ngoài khả năng mermaid thì không
 * đưa vào (issue #231 quyết định 1 — wrapper giữ contract tối giản).
 * Title không nằm ở đây — là tham số riêng của builder (rỗng → không vẽ title).
 */
export interface ChartStyleConfig {
  width: number
  height: number
  /** Tiêu đề trục x (bar/line); rỗng → không thêm. */
  xAxisTitle?: string
  /** Nhãn trục y (bar/line); rỗng → dùng valueLabel. */
  yAxisLabel?: string
  /** Màu bar/line (hex). */
  color?: string
  /** Bảng màu section pie (hex). */
  pieColors?: string[]
}

export const DEFAULT_CHART_STYLE: ChartStyleConfig = {
  width: 720,
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

/** Giới hạn kéo-resize chart (px). */
export const CHART_MIN_WIDTH = 320
export const CHART_MAX_WIDTH = 4000
export const CHART_MIN_HEIGHT = 180
export const CHART_MAX_HEIGHT = 3000

export function clampChartSize(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.min(CHART_MAX_WIDTH, Math.max(CHART_MIN_WIDTH, Math.round(width))),
    height: Math.min(CHART_MAX_HEIGHT, Math.max(CHART_MIN_HEIGHT, Math.round(height))),
  }
}

/** Chỉ chấp nhận hex màu (#rgb..#rrggbbaa) — chặn inject YAML qua chuỗi màu. */
function safeHex(value: string | undefined): string | null {
  return value && /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : null
}

/** Directive frontmatter `--- config: ---` áp kích thước + màu cho diagram. */
function buildDirectives(kind: ChartKind, style?: ChartStyleConfig): string {
  if (!style) return ''
  const configLines: string[] = []
  const themeVars: string[] = []
  if (kind === 'pie') {
    const colors = (style.pieColors ?? []).map(safeHex).filter((c): c is string => !!c)
    colors.forEach((c, i) => themeVars.push(`    pie${i + 1}: "${c}"`))
  } else {
    const size = clampChartSize(style.width, style.height)
    configLines.push('  xyChart:', `    width: ${size.width}`, `    height: ${size.height}`)
    const color = safeHex(style.color)
    if (color) themeVars.push(`    xyChart:`, `      plotColorPalette: "${color}"`)
  }
  if (!configLines.length && !themeVars.length) return ''
  const out = ['---', 'config:']
  out.push(...configLines)
  if (themeVars.length) out.push('  themeVariables:', ...themeVars)
  out.push('---')
  return `${out.join('\n')}\n`
}

/**
 * Làm sạch label cho mermaid: mermaid vỡ với `"`/brackets/newline kể cả trong
 * chuỗi đã quote ở một số diagram (pie title, xychart category). Thay `'` cho
 * `"` rồi bỏ ký tự dễ vỡ — taskId/model thường chỉ còn ký tự an toàn.
 */
export function escapeMermaidText(value: string): string {
  const cleaned = value
    .replace(/"/g, "'")
    .replace(/[\r\n\t]+/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]+/g, '')
    .replace(/[{}[\]()<>|;`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return '—'
  return cleaned.length > LABEL_MAX_CHARS ? `${cleaned.slice(0, LABEL_MAX_CHARS - 1)}…` : cleaned
}

export interface AxisChartInput {
  /** Tiêu đề chart; rỗng → KHÔNG vẽ dòng title. */
  title: string
  categories: string[]
  values: number[]
  /** Nhãn trục y (vd "Total tokens"). */
  valueLabel: string
  /** Thuộc tính hiển thị (kích thước/màu/nhãn trục). */
  style?: ChartStyleConfig
  /** Scale đơn vị (K/M/B) — giá trị chia divisor, nhãn trục y thêm suffix. */
  unitScale?: { divisor: number; axisSuffix: string }
}

function toInt(v: number): number {
  return Math.max(0, Math.round(v))
}

function axisUpperBound(values: number[]): number {
  return Math.max(1, ...values.map(toInt))
}

function axisChartLines(kind: 'bar' | 'line', input: AxisChartInput): string[] {
  const divisor = input.unitScale?.divisor ?? 1
  const values = input.values.map((v) => toInt(v / divisor))
  const categories = input.categories.map((c) => `"${escapeMermaidText(c)}"`)
  const xTitle = input.style?.xAxisTitle ? `"${escapeMermaidText(input.style.xAxisTitle)}" ` : ''
  // Suffix đơn vị là chuỗi tự sinh "(K)/(M)/(B)" — nối SAU escape để giữ dấu ngoặc.
  const yLabel = `${escapeMermaidText(input.style?.yAxisLabel || input.valueLabel)}${input.unitScale?.axisSuffix ?? ''}`
  const lines = ['xychart-beta']
  if (input.title) lines.push(`  title "${escapeMermaidText(input.title)}"`)
  lines.push(
    `  x-axis ${xTitle}[${categories.join(', ')}]`,
    `  y-axis "${yLabel}" 0 --> ${axisUpperBound(values)}`,
    `  ${kind} [${values.join(', ')}]`,
  )
  return lines
}

/** xychart-beta dạng bar: `x-axis ["A","B"]` quote luôn để thoải mái ký tự. */
export function buildBarChart(input: AxisChartInput): string {
  return `${buildDirectives('bar', input.style)}${axisChartLines('bar', input).join('\n')}`
}

/** xychart-beta dạng line — dùng cho trend theo ngày. */
export function buildLineChart(input: AxisChartInput): string {
  return `${buildDirectives('line', input.style)}${axisChartLines('line', input).join('\n')}`
}

export interface PieSlice {
  label: string
  value: number
}

/** Pie + showData (hiển thị giá trị trên slide); title rỗng → không vẽ. */
export function buildPieChart(input: {
  title: string
  slices: PieSlice[]
  style?: ChartStyleConfig
  unitScale?: { divisor: number; axisSuffix: string }
}): string {
  const divisor = input.unitScale?.divisor ?? 1
  const rows = input.slices.map(
    (s) => `  "${escapeMermaidText(s.label)}" : ${toInt(s.value / divisor)}`,
  )
  const body = ['pie showData']
  if (input.title) body.push(`  title "${escapeMermaidText(input.title)}"`)
  body.push(...rows)
  return `${buildDirectives('pie', input.style)}${body.join('\n')}`
}

/** Build theo loại chart — ChartCard gọi chung một cửa. */
export function buildChart(
  kind: ChartKind,
  input: {
    title: string
    labels: string[]
    values: number[]
    valueLabel: string
    style?: ChartStyleConfig
    unitScale?: { divisor: number; axisSuffix: string }
  },
): string {
  if (kind === 'pie') {
    return buildPieChart({
      title: input.title,
      slices: input.labels.map((label, i) => ({ label, value: input.values[i] ?? 0 })),
      style: input.style,
      unitScale: input.unitScale,
    })
  }
  const builder = kind === 'line' ? buildLineChart : buildBarChart
  return builder({
    title: input.title,
    categories: input.labels,
    values: input.values,
    valueLabel: input.valueLabel,
    style: input.style,
    unitScale: input.unitScale,
  })
}
