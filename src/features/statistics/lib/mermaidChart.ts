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
  title: string
  categories: string[]
  values: number[]
  /** Nhãn trục y (vd "Total tokens"). */
  valueLabel: string
}

function toInt(v: number): number {
  return Math.max(0, Math.round(v))
}

function axisUpperBound(values: number[]): number {
  return Math.max(1, ...values.map(toInt))
}

/** xychart-beta dạng bar: `x-axis ["A","B"]` quote luôn để thoải mái ký tự. */
export function buildBarChart(input: AxisChartInput): string {
  const values = input.values.map(toInt)
  const categories = input.categories.map((c) => `"${escapeMermaidText(c)}"`)
  return [
    'xychart-beta',
    `  title "${escapeMermaidText(input.title)}"`,
    `  x-axis [${categories.join(', ')}]`,
    `  y-axis "${escapeMermaidText(input.valueLabel)}" 0 --> ${axisUpperBound(values)}`,
    `  bar [${values.join(', ')}]`,
  ].join('\n')
}

/** xychart-beta dạng line — dùng cho trend theo ngày. */
export function buildLineChart(input: AxisChartInput): string {
  const values = input.values.map(toInt)
  const categories = input.categories.map((c) => `"${escapeMermaidText(c)}"`)
  return [
    'xychart-beta',
    `  title "${escapeMermaidText(input.title)}"`,
    `  x-axis [${categories.join(', ')}]`,
    `  y-axis "${escapeMermaidText(input.valueLabel)}" 0 --> ${axisUpperBound(values)}`,
    `  line [${values.join(', ')}]`,
  ].join('\n')
}

export interface PieSlice {
  label: string
  value: number
}

/** Pie + showData (hiển thị giá trị trên slide). */
export function buildPieChart(input: { title: string; slices: PieSlice[] }): string {
  const rows = input.slices.map((s) => `  "${escapeMermaidText(s.label)}" : ${toInt(s.value)}`)
  return ['pie showData', `  title "${escapeMermaidText(input.title)}"`, ...rows].join('\n')
}

/** Build theo loại chart — ChartCard gọi chung một cửa. */
export function buildChart(
  kind: ChartKind,
  input: { title: string; labels: string[]; values: number[]; valueLabel: string },
): string {
  if (kind === 'pie') {
    return buildPieChart({
      title: input.title,
      slices: input.labels.map((label, i) => ({ label, value: input.values[i] ?? 0 })),
    })
  }
  const builder = kind === 'line' ? buildLineChart : buildBarChart
  return builder({
    title: input.title,
    categories: input.labels,
    values: input.values,
    valueLabel: input.valueLabel,
  })
}
