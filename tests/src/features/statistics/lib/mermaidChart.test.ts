import { describe, expect, it } from 'vitest'
import {
  buildBarChart,
  buildChart,
  buildLineChart,
  buildPieChart,
  clampChartSize,
  escapeMermaidText,
  DEFAULT_CHART_STYLE,
} from '@/features/statistics/lib/mermaidChart'

describe('escapeMermaidText', () => {
  it('thay " bằng nháy đơn, bỏ brackets/newline/ký tự điều khiển', () => {
    expect(escapeMermaidText('bad"label')).toBe("bad'label")
    expect(escapeMermaidText('a[b]{c}(d)<e>|f;`g\\h')).toBe('abcdefgh')
    expect(escapeMermaidText('line1\nline2\ttab')).toBe('line1 line2 tab')
  })

  it('cắt nhãn dài quá 28 ký tự, rỗng → gạch nối', () => {
    const long = 'a'.repeat(40)
    expect(escapeMermaidText(long)).toBe(`${'a'.repeat(27)}…`)
    expect(escapeMermaidText('   ')).toBe('—')
  })
})

describe('buildBarChart / buildLineChart', () => {
  const input = {
    title: 'Total theo task',
    categories: ['TA1', 'TB1'],
    values: [160, 1500],
    valueLabel: 'Total tokens',
  }

  it('bar: xychart-beta + categories quote + y range <min> --> <max>', () => {
    const def = buildBarChart(input)
    expect(def).toContain('xychart-beta')
    expect(def).toContain('title "Total theo task"')
    expect(def).toContain('x-axis ["TA1", "TB1"]')
    expect(def).toContain('y-axis "Total tokens" 0 --> 1500')
    expect(def).toContain('bar [160, 1500]')
  })

  it('line: cùng trục nhưng dùng line', () => {
    const def = buildLineChart(input)
    expect(def).toContain('line [160, 1500]')
    expect(def).not.toContain('bar [')
  })

  it('max 0 → cột trên trục tối thiểu 1, giá trị làm tròn không âm', () => {
    const def = buildBarChart({ ...input, values: [0, -3.7] })
    expect(def).toContain('0 --> 1')
    expect(def).toContain('bar [0, 0]')
  })
})

describe('buildPieChart + buildChart', () => {
  it('pie showData + slice "label" : value', () => {
    const def = buildPieChart({ title: 'Tỉ trọng', slices: [{ label: 'TA', value: 30 }, { label: 'TB', value: 70 }] })
    expect(def.split('\n')[0]).toBe('pie showData')
    expect(def).toContain('"TA" : 30')
    expect(def).toContain('"TB" : 70')
  })

  it('buildChart điều hướng đúng builder theo kind', () => {
    const base = { title: 'T', labels: ['a', 'b'], values: [1, 2], valueLabel: 'V' }
    expect(buildChart('pie', base)).toContain('pie showData')
    expect(buildChart('bar', base)).toContain('bar [1, 2]')
    expect(buildChart('line', base)).toContain('line [1, 2]')
  })

  it('label có ký tự nguy hiểm được escape trong mọi builder', () => {
    const base = { title: 'T', labels: ['we"ird[l]abel'], values: [5], valueLabel: 'V' }
    expect(buildChart('bar', base)).toContain('"we\'irdlabel"')
    expect(buildChart('pie', base)).toContain('"we' + "'" + 'irdlabel" : 5')
  })
})

describe('ChartStyleConfig — directive config + nhãn/màu ghi đè', () => {
  const base = {
    title: 'Total theo task',
    categories: ['TA1', 'TB1'],
    values: [160, 1500],
    valueLabel: 'Total tokens',
  }

  it('bar với style: directive xyChart width/height + plotColorPalette + title trục x', () => {
    const def = buildBarChart({
      ...base,
      style: { ...DEFAULT_CHART_STYLE, width: 900, height: 400, color: '#2ECC71', xAxisTitle: 'Task', titleOverride: 'Tùy chỉnh', yAxisLabel: 'Tokens' },
    })
    expect(def).toContain('---\nconfig:')
    expect(def).toContain('  xyChart:\n    width: 900\n    height: 400')
    expect(def).toContain('themeVariables:')
    expect(def).toContain('plotColorPalette: "#2ECC71"')
    expect(def).toContain('title "Tùy chỉnh"')
    expect(def).toContain('x-axis "Task" ["TA1", "TB1"]')
    expect(def).toContain('y-axis "Tokens" 0 --> 1500')
  })

  it('không có style → không sinh directive (giữ definition tối giản)', () => {
    expect(buildBarChart(base)).not.toContain('config:')
  })

  it('pie với pieColors → themeVariables pie1..N; màu không hợp lệ bị bỏ', () => {
    const def = buildPieChart({
      title: 'T',
      slices: [{ label: 'a', value: 1 }],
      style: { ...DEFAULT_CHART_STYLE, pieColors: ['#e6194b', 'javascript:alert(1)', '#3cb44b'] },
    })
    expect(def).toContain('pie1: "#e6194b"')
    expect(def).toContain('pie2: "#3cb44b"')
    expect(def).not.toContain('pie3')
    expect(def).not.toContain('javascript')
  })

  it('clampChartSize giới hạn kích thước kéo-resize', () => {
    expect(clampChartSize(10, 10)).toEqual({ width: 320, height: 180 })
    expect(clampChartSize(99999, 99999)).toEqual({ width: 4000, height: 3000 })
    expect(clampChartSize(720.6, 300.4)).toEqual({ width: 721, height: 300 })
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
      valueLabel: 'Total tokens',
    }
    await expect(mermaid.parse(buildBarChart(base))).resolves.toBeTruthy()
    await expect(mermaid.parse(buildLineChart(base))).resolves.toBeTruthy()
    await expect(
      mermaid.parse(
        buildPieChart({ title: 'T', slices: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] }),
      ),
    ).resolves.toBeTruthy()

    // Có style (directive config + title trục x) vẫn parse OK.
    await expect(
      mermaid.parse(
        buildBarChart({
          ...base,
          style: { ...DEFAULT_CHART_STYLE, xAxisTitle: 'Task', color: '#2ECC71' },
        }),
      ),
    ).resolves.toBeTruthy()
    await expect(
      mermaid.parse(
        buildPieChart({
          title: 'T',
          slices: [{ label: 'a', value: 1 }],
          style: DEFAULT_CHART_STYLE,
        }),
      ),
    ).resolves.toBeTruthy()

    // Đối chứng: range sai (`--> 0..N`) phải bị reject.
    await expect(mermaid.parse('xychart-beta\n  y-axis "V" --> 0..5\n  bar [1]')).rejects.toThrow()
  })
})
