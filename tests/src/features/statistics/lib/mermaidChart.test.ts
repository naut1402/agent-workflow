import { describe, expect, it } from 'vitest'
import {
  buildBarChart,
  buildChart,
  clampChartHeight,
  buildLineChart,
  buildPieChart,
  escapeMermaidText,
  DEFAULT_CHART_STYLE,
} from '@/features/statistics/lib/mermaidChart'

describe('escapeMermaidText', () => {
  it('thay " bằng nháy đơn, bỏ brackets/newline/ký tự điều khiển', () => {
    expect(escapeMermaidText('bad"label')).toBe("bad'label")
    expect(escapeMermaidText('a[b]{c}(d)<e>|f;`g\\h')).toBe('abcdefgh')
    expect(escapeMermaidText('line1\nline2\ttab')).toBe('line1 line2 tab')
  })

  it('cắt nhãn theo maxChars, rỗng → gạch nối', () => {
    const long = 'a'.repeat(40)
    expect(escapeMermaidText(long)).toBe(`${'a'.repeat(27)}…`)
    expect(escapeMermaidText(long, 14)).toBe(`${'a'.repeat(13)}…`)
    expect(escapeMermaidText('   ')).toBe('—')
  })
})

describe('buildBarChart / buildLineChart', () => {
  const input = {
    title: 'Total theo task',
    categories: ['TA1', 'TB1'],
    values: [160, 1500],
    width: 720,
  }

  it('bar: xychart-beta + categories quote + y range <min> --> <max>, KHÔNG title trục y mặc định', () => {
    const def = buildBarChart(input)
    expect(def).toContain('xychart-beta')
    expect(def).toContain('title "Total theo task"')
    expect(def).toContain('x-axis ["TA1", "TB1"]')
    // Mặc định không vẽ title trục y — tránh mermaid vẽ chữ dọc đè lên số tick.
    expect(def).toContain('y-axis 0 --> 1500')
    expect(def).toContain('bar [160, 1500]')
  })

  it('line: cùng trục nhưng dùng line', () => {
    const def = buildLineChart(input)
    expect(def).toContain('line [160, 1500]')
    expect(def).not.toContain('bar [')
  })

  it('đặt yAxisLabel mới vẽ title trục y (kèm suffix đơn vị)', () => {
    const def = buildBarChart({
      ...input,
      style: { ...DEFAULT_CHART_STYLE, yAxisLabel: 'Tokens' },
      unitScale: { divisor: 1_000, axisSuffix: ' (K)' },
    })
    // Giá trị cũng chia theo divisor: 160/1000→0, 1500/1000→2.
    expect(def).toContain('y-axis "Tokens (K)" 0 --> 2')
  })

  it('max 0 → cột trên trục tối thiểu 1, giá trị làm tròn không âm', () => {
    const def = buildBarChart({ ...input, values: [0, -3.7] })
    expect(def).toContain('0 --> 1')
    expect(def).toContain('bar [0, 0]')
  })
})

describe('ChartStyleConfig — directive config + nhãn/màu ghi đè', () => {
  const base = {
    title: 'Total theo task',
    categories: ['TA1', 'TB1'],
    values: [160, 1500],
    width: 900,
  }

  it('bar với style: directive xyChart width/height + plotColorPalette + title trục x', () => {
    const def = buildBarChart({
      ...base,
      style: { ...DEFAULT_CHART_STYLE, height: 400, color: '#2ECC71', xAxisTitle: 'Task' },
    })
    expect(def).toContain('---\nconfig:')
    expect(def).toContain('  xyChart:\n    width: 900\n    height: 400')
    expect(def).toContain('themeVariables:')
    expect(def).toContain('plotColorPalette: "#2ECC71"')
    expect(def).toContain('x-axis "Task" ["TA1", "TB1"]')
    expect(def).toContain('y-axis 0 --> 1500')
  })

  it('title rỗng → không vẽ dòng title (bar/line/pie)', () => {
    const bar = buildBarChart({ ...base, title: '' })
    expect(bar).not.toContain('title "')
    const line = buildLineChart({ ...base, title: '' })
    expect(line).not.toContain('title "')
    const pie = buildPieChart({ title: '', slices: [{ label: 'a', value: 1 }], width: 900 })
    expect(pie).not.toContain('title "')
  })

  it('unitScale chia giá trị theo divisor', () => {
    const def = buildBarChart({
      ...base,
      values: [160_000, 1_500_000],
      unitScale: { divisor: 1_000, axisSuffix: ' (K)' },
    })
    expect(def).toContain('bar [160, 1500]')
    const pie = buildPieChart({
      title: 'T',
      slices: [{ label: 'a', value: 25_000 }],
      width: 900,
      unitScale: { divisor: 1_000, axisSuffix: ' (K)' },
    })
    expect(pie).toContain('"a" : 25')
  })

  it('không có style → không sinh directive (giữ definition tối giản)', () => {
    expect(buildBarChart(base)).not.toContain('config:')
  })

  it('pie với pieColors → themeVariables pie1..N; màu không hợp lệ bị bỏ', () => {
    const def = buildPieChart({
      title: 'T',
      slices: [{ label: 'a', value: 1 }],
      width: 900,
      style: { ...DEFAULT_CHART_STYLE, pieColors: ['#e6194b', 'javascript:alert(1)', '#3cb44b'] },
    })
    expect(def).toContain('pie1: "#e6194b"')
    expect(def).toContain('pie2: "#3cb44b"')
    expect(def).not.toContain('pie3')
    expect(def).not.toContain('javascript')
  })

  it('clampChartHeight giới hạn chiều cao kéo-resize', () => {
    expect(clampChartHeight(10)).toBe(180)
    expect(clampChartHeight(99999)).toBe(3000)
    expect(clampChartHeight(300.4)).toBe(300)
  })
})

describe('parse bằng mermaid thật (jsdom)', () => {
  // Gate cú pháp thật: test string ở trên không bắt được lỗi grammar
  // (vd từng ship `y-axis "V" --> 0..N` sai range syntax).
  it('definition bar/line/pie parse OK, cú pháp sai bị reject', async () => {
    const mermaid = (await import('mermaid')).default
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })

    const base = {
      title: 'Total theo task',
      categories: ['TA1', 'we"ird label', 'đà có dấu'],
      values: [160, 1500, 0],
      width: 720,
    }
    await expect(mermaid.parse(buildBarChart(base))).resolves.toBeTruthy()
    await expect(mermaid.parse(buildLineChart(base))).resolves.toBeTruthy()
    await expect(
      mermaid.parse(
        buildPieChart({ title: 'T', slices: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }], width: 720 }),
      ),
    ).resolves.toBeTruthy()

    // Có style (directive config + title trục) vẫn parse OK.
    await expect(
      mermaid.parse(
        buildBarChart({
          ...base,
          style: { ...DEFAULT_CHART_STYLE, xAxisTitle: 'Task', yAxisLabel: 'Tokens', color: '#2ECC71' },
        }),
      ),
    ).resolves.toBeTruthy()
    await expect(
      mermaid.parse(
        buildPieChart({
          title: 'T',
          slices: [{ label: 'a', value: 1 }],
          width: 720,
          style: DEFAULT_CHART_STYLE,
        }),
      ),
    ).resolves.toBeTruthy()

    // Đối chứng: range sai (`--> 0..N`) phải bị reject.
    await expect(mermaid.parse('xychart-beta\n  y-axis "V" --> 0..5\n  bar [1]')).rejects.toThrow()
  })
})

describe('buildChart', () => {
  it('điều hướng đúng builder theo kind', () => {
    const base = { title: 'T', labels: ['a', 'b'], values: [1, 2], width: 720 }
    expect(buildChart('pie', base)).toContain('pie showData')
    expect(buildChart('bar', base)).toContain('bar [1, 2]')
    expect(buildChart('line', base)).toContain('line [1, 2]')
  })

  it('label có ký tự nguy hiểm được escape trong mọi builder', () => {
    const base = { title: 'T', labels: ['we"ird[l]abel'], values: [5], width: 720 }
    expect(buildChart('bar', base)).toContain('"we\'irdlabel"')
    expect(buildChart('pie', base)).toContain('"we' + "'" + 'irdlabel" : 5')
  })
})
