import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ChartCard from '@/features/statistics/components/ChartCard.vue'
import { mountWithI18n } from '../../../helpers/i18n'

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
    valueLabel: 'Total tokens',
    ...overrides,
  }
}

// jsdom không có PointerEvent — dispatch MouseEvent với type pointer* là đủ
// vì listener gắn theo type string và clientX/Y có trên MouseEvent.
function pointerEvent(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, { clientX: x, clientY: y, bubbles: true })
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

  it('slot control render vào header card', () => {
    const wrapper = mountWithI18n(ChartCard, {
      props: props(),
      slots: { control: '<button class="stub-control">metric</button>' },
    })
    expect(wrapper.find('.chart-card-controls .stub-control').exists()).toBe(true)
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

  it('kéo handle góc chart → emit resize với kích thước clamp', async () => {
    // Listener move/up nằm trên window — phải mount vào document để event bubble tới.
    const wrapper = mountWithI18n(ChartCard, {
      props: props({ styleConfig: { width: 720, height: 300 } }),
      attachTo: document.body,
    })
    await flushPromises()
    const handle = wrapper.find('.chart-resize-handle')
    expect(handle.exists()).toBe(true)

    // trigger() của VTU không gắn được clientX/Y → dispatch MouseEvent thật.
    const el = handle.element
    el.dispatchEvent(pointerEvent('pointerdown', 100, 100))
    // Kéo vượt min để kiểm tra clamp: delta X -2100 → width 320; delta Y +70 → 370.
    el.dispatchEvent(pointerEvent('pointermove', -2000, 170))
    el.dispatchEvent(pointerEvent('pointerup', -2000, 170))
    await flushPromises()

    const emitted = wrapper.emitted('resize')
    expect(emitted).toBeTruthy()
    expect(emitted![0]).toEqual([320, 370])
    wrapper.unmount()
  })

  it('styleConfig truyền vào definition (directive config xuất hiện trong node)', async () => {
    const wrapper = mountWithI18n(ChartCard, {
      props: props({ styleConfig: { width: 900, height: 400, color: '#2ECC71' } }),
    })
    await flushPromises()
    const root = (renderMermaid as ReturnType<typeof vi.fn>).mock.calls[0][0] as HTMLElement
    const src = root.querySelector('.mermaid')?.textContent ?? ''
    expect(src).toContain('width: 900')
    expect(src).toContain('plotColorPalette: "#2ECC71"')
  })
})
