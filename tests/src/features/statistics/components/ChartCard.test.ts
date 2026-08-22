import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import ChartCard from '@/features/statistics/components/ChartCard.vue'
import { mountWithI18n } from '../../../helpers/i18n'
import { DEFAULT_CHART_STYLE } from '@/features/statistics/lib/chartConfig'

// jsdom không implement canvas 2d context — chart.js thật không dựng được.
// Mock chart.js/auto với class giả ghi lại config để assert translation props → chart.
const instances: Array<{ config: Record<string, unknown>; destroyed: boolean }> = []

vi.mock('chart.js/auto', () => ({
  default: class FakeChart {
    config: Record<string, unknown>
    destroyed = false
    constructor(_canvas: unknown, config: Record<string, unknown>) {
      this.config = config
      instances.push(this)
    }
    destroy() {
      this.destroyed = true
    }
    update() {}
  },
}))

import FakeChart from 'chart.js/auto'

function props(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Total theo task',
    chartType: 'bar' as const,
    labels: ['TA1', 'TB1'],
    values: [160, 1500],
    ...overrides,
  }
}

function lastInstance() {
  return instances[instances.length - 1]
}

afterEach(() => {
  vi.clearAllMocks()
  instances.length = 0
})

describe('ChartCard (renderer chart.js)', () => {
  it('mount có dữ liệu → dựng Chart đúng type/labels/values', async () => {
    mountWithI18n(ChartCard, { props: props() })
    await flushPromises()

    expect(instances).toHaveLength(1)
    const cfg = lastInstance().config as {
      type: string
      data: { labels: string[]; datasets: Array<{ data: number[]; backgroundColor: unknown }> }
    }
    expect(cfg.type).toBe('bar')
    expect(cfg.data.labels).toEqual(['TA1', 'TB1'])
    expect(cfg.data.datasets[0].data).toEqual([160, 1500])
  })

  it('đổi props data → tạo lại Chart với data mới, unmount → destroy', async () => {
    const wrapper = mountWithI18n(ChartCard, { props: props() })
    await flushPromises()

    await wrapper.setProps({ values: [999, 1], chartType: 'line' })
    await flushPromises()
    const cfg = lastInstance().config as { type: string; data: { datasets: Array<{ data: number[] }> } }
    expect(cfg.type).toBe('line')
    expect(cfg.data.datasets[0].data).toEqual([999, 1])
    expect(instances[0].destroyed).toBe(true) // instance cũ bị destroy khi tạo lại

    wrapper.unmount()
    expect(lastInstance().destroyed).toBe(true)
  })

  it('pie: dùng bảng màu styleConfig; bar: dùng màu đơn + tick format theo numberFormat', async () => {
    mountWithI18n(ChartCard, {
      props: props({
        chartType: 'pie',
        styleConfig: { ...DEFAULT_CHART_STYLE, pieColors: ['#111111', '#222222'] },
      }),
    })
    await flushPromises()
    const pie = lastInstance().config as { data: { datasets: Array<{ backgroundColor: string[] }> } }
    expect(pie.data.datasets[0].backgroundColor).toEqual(['#111111', '#222222'])

    mountWithI18n(ChartCard, {
      props: props({ styleConfig: { ...DEFAULT_CHART_STYLE, color: '#2ECC71' }, numberFormat: 'full' }),
    })
    await flushPromises()
    const bar = lastInstance().config as {
      data: { datasets: Array<{ backgroundColor: string }> }
      options: { scales: { y: { ticks: { callback: (v: number) => string } } } }
    }
    expect(bar.data.datasets[0].backgroundColor).toBe('#2ECC71')
    // Tick trục y định dạng theo numberFormat (full → dấu phẩy).
    expect(bar.options.scales.y.ticks.callback(1234567)).toBe('1,234,567')
  })

  it('không có dữ liệu → empty state, không dựng Chart', async () => {
    const wrapper = mountWithI18n(ChartCard, {
      props: props({ labels: [], values: [] }),
    })
    await flushPromises()
    expect(instances).toHaveLength(0)
    expect(wrapper.find('.chart-card-state').text()).toBeTruthy()
    expect(wrapper.find('canvas').exists()).toBe(false)
  })

  it('loading → hiện trạng thái loading thay vì chart', () => {
    const wrapper = mountWithI18n(ChartCard, { props: props({ loading: true }) })
    expect(wrapper.find('canvas').exists()).toBe(false)
    expect(wrapper.find('.chart-card-body').exists()).toBe(false)
  })
})

// Ngăn lint báo FakeChart chưa dùng — class dùng qua side-effect mock phía trên.
void FakeChart
