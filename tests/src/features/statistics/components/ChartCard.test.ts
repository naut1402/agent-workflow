import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import ChartCard from '@/features/statistics/components/ChartCard.vue'
import { mountWithI18n } from '../../../helpers/i18n'
import { DEFAULT_CHART_STYLE } from '@/features/statistics/lib/mermaidChart'

// renderMermaid lazy-import mermaid thật — trong jsdom không vẽ được ổn định;
// mock để assert wiring (được gọi với root + definition đúng) thay vì pixel.
vi.mock('@/core/lib/markdownLib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/lib/markdownLib')>()
  return {
    ...actual,
    renderMermaid: vi.fn(async () => {}),
  }
})

import { renderMermaid } from '@/core/lib/markdownLib'
import { attachMermaidControls } from '@/core/composables/useMermaidControls'

vi.mock('@/core/composables/useMermaidControls', () => ({
  attachMermaidControls: vi.fn(),
}))

afterEach(() => {
  vi.clearAllMocks()
})

function props(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Total theo task',
    chartType: 'bar' as const,
    labels: ['TA1', 'TB1'],
    values: [160, 1500],
    ...overrides,
  }
}

describe('ChartCard (wrapper renderer mermaid)', () => {
  it('mount → renderMermaid + attachMermaidControls với node chứa definition', async () => {
    mountWithI18n(ChartCard, { props: props() })
    await flushPromises()

    expect(renderMermaid).toHaveBeenCalled()
    const root = (renderMermaid as ReturnType<typeof vi.fn>).mock.calls[0][0] as HTMLElement
    expect(root.querySelector('.mermaid')?.textContent).toContain('xychart-beta')
    expect(root.querySelector('.mermaid')?.textContent).toContain('bar [160, 1500]')
    expect(attachMermaidControls).toHaveBeenCalled()
  })

  it('đổi props data → gọi renderMermaid lại với definition mới', async () => {
    const wrapper = mountWithI18n(ChartCard, { props: props() })
    await flushPromises()
    ;(renderMermaid as ReturnType<typeof vi.fn>).mockClear()

    await wrapper.setProps({ values: [999, 1], chartType: 'line' })
    await flushPromises()
    expect(renderMermaid).toHaveBeenCalled()
    const root = (renderMermaid as ReturnType<typeof vi.fn>).mock.calls[0][0] as HTMLElement
    expect(root.querySelector('.mermaid')?.textContent).toContain('line [999, 1]')
  })

  it('styleConfig truyền vào definition (directive config + height theo body)', async () => {
    mountWithI18n(ChartCard, {
      props: props({ styleConfig: { ...DEFAULT_CHART_STYLE, height: 400, color: '#2ECC71' } }),
    })
    await flushPromises()
    const root = (renderMermaid as ReturnType<typeof vi.fn>).mock.calls[0][0] as HTMLElement
    const src = root.querySelector('.mermaid')?.textContent ?? ''
    // jsdom không đo được clientWidth → fallback 720; height từ config.
    expect(src).toContain('width: 720')
    expect(src).toContain('height: 400')
    expect(src).toContain('plotColorPalette: "#2ECC71"')
  })

  it('không có dữ liệu (toàn 0/rỗng) → empty state, không render chart', async () => {
    const wrapper = mountWithI18n(ChartCard, {
      props: props({ labels: [], values: [] }),
    })
    await flushPromises()
    expect(wrapper.find('.chart-card-body').exists()).toBe(false)
    expect(wrapper.find('.chart-card-state').text()).toBeTruthy()
    expect(renderMermaid).not.toHaveBeenCalled()
  })

  it('loading → hiện trạng thái loading thay vì chart', () => {
    const wrapper = mountWithI18n(ChartCard, { props: props({ loading: true }) })
    expect(wrapper.find('.chart-card-body').exists()).toBe(false)
  })
})
