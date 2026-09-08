import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountWithI18n } from '../../../helpers/i18n'

/**
 * The chat window's header used to carry three separate indicators: a
 * connection dot, a busy spinner and a done/error icon. All three are gone —
 * the title itself is colour-coded and the info popover holds the context. This
 * suite pins that down (the header was otherwise only covered by e2e).
 *
 * Both bodies are stubbed: they poll the network and own no header markup, and
 * the only thing the header takes from them is the `status` they emit. Each stub
 * parks its own `emit` in `emitters`, so a test can drive the header's status
 * straight from the outside.
 */
const { emitters } = vi.hoisted(() => ({ emitters: [] as ((s: unknown) => void)[] }))

async function bodyStubModule(cls: string) {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      emits: ['status', 'runner', 'close'],
      setup(_props, { emit }) {
        emitters.push((s) => emit('status', s))
        emit('status', { kind: 'idle', text: 'Sẵn sàng' })
        return () => h('div', { class: cls })
      },
    }),
  }
}

vi.mock('@/features/nl-chat/components/BuilderChatBody.vue', () =>
  bodyStubModule('stub-builder-body'),
)
vi.mock('@/features/nl-chat/components/TaskChatBody.vue', () => bodyStubModule('stub-task-body'))

import ChatWindow from '@/features/nl-chat/components/ChatWindow.vue'
import { useChatSurface } from '@/features/nl-chat/composables/useChatSurface'

type Status = { kind: 'idle' | 'busy' | 'done' | 'error'; text: string }

/** The registry is a module singleton — a leftover session leaks into the next test. */
function resetSurface(): void {
  const { sessions, activeId, closeSession, openBuilderChat, close } = useChatSurface()
  openBuilderChat()
  const builderId = activeId.value
  for (const s of [...sessions.value]) if (s.id !== builderId) closeSession(s.id)
  close()
}

function mountWindow(props: Record<string, unknown> = {}) {
  return mountWithI18n(ChatWindow, { props })
}

/** Wrappers attached to the document, so `afterEach` can take them back off. */
const attached: ReturnType<typeof mountWindow>[] = []

/**
 * Dismissal runs off `document` listeners and an `infoRef.contains(target)`
 * check, and neither means anything for a detached tree — these tests have to
 * mount into the real document.
 */
function mountAttached(props: Record<string, unknown> = {}) {
  const wrapper = mountWithI18n(ChatWindow, { props, attachTo: document.body })
  attached.push(wrapper)
  return wrapper
}

async function setStatus(wrapper: ReturnType<typeof mountWindow>, status: Status) {
  for (const emit of emitters) emit(status)
  await wrapper.vm.$nextTick()
}

beforeEach(() => {
  emitters.length = 0
  resetSurface()
  // The builder's info popover looks the default runner up over the network.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ runners: [] }) })),
  )
})

afterEach(() => {
  for (const w of attached.splice(0)) w.unmount()
  vi.unstubAllGlobals()
})

describe('ChatWindow header — status lives in the title', () => {
  it.each([
    ['busy', 'is-busy'],
    ['done', 'is-done'],
    ['error', 'is-error'],
    ['idle', 'is-idle'],
  ] as const)('%s colour-codes the title with %s', async (kind, cls) => {
    const wrapper = mountWindow()
    await setStatus(wrapper, { kind, text: `trạng thái ${kind}` })
    expect(wrapper.find('.nl-chat-title').classes()).toContain(cls)
  })

  it('an error title describes the error in its tooltip', async () => {
    const wrapper = mountWindow()
    await setStatus(wrapper, { kind: 'error', text: 'Có lỗi' })

    const title = wrapper.find('.nl-chat-title')
    expect(title.attributes('title')).toContain('Có lỗi')
    // The name is still in there, so the tooltip stays useful when the ellipsis
    // cuts the title short.
    expect(title.attributes('title')).toContain(title.text())
  })

  it('an idle title carries no status in its tooltip', async () => {
    const wrapper = mountWindow()
    await setStatus(wrapper, { kind: 'idle', text: 'Sẵn sàng' })

    const title = wrapper.find('.nl-chat-title')
    expect(title.attributes('title')).toBe(title.text())
  })

  it.each([
    ['busy', 'Đang xử lý'],
    ['done', 'Hoàn tất'],
    ['error', 'Có lỗi'],
  ] as const)('announces the %s status as text, not only as colour', async (kind, announced) => {
    const wrapper = mountWindow()
    await setStatus(wrapper, { kind, text: `mô tả ${kind}` })

    const live = wrapper.find('.nl-chat-sr-only[role="status"]')
    expect(live.exists()).toBe(true)
    expect(live.text()).toBe(announced)
  })

  it('does not re-announce while only the busy counter ticks', async () => {
    const wrapper = mountWindow()
    const live = () => wrapper.find('.nl-chat-sr-only[role="status"]').text()

    // The builder's busy text carries a seconds counter that changes every
    // second. A live region that mirrored it would read the whole status out
    // again on every tick.
    await setStatus(wrapper, { kind: 'busy', text: 'Agent đang suy nghĩ… 1s' })
    const first = live()
    await setStatus(wrapper, { kind: 'busy', text: 'Agent đang suy nghĩ… 2s' })
    expect(live()).toBe(first)

    // A real state change still gets announced.
    await setStatus(wrapper, { kind: 'done', text: 'Hoàn tất' })
    expect(live()).not.toBe(first)
  })

  it('drops the dot, the badge and the status slot entirely', async () => {
    const wrapper = mountWindow({ connected: true })
    await setStatus(wrapper, { kind: 'error', text: 'Có lỗi' })

    expect(wrapper.findAll('.nl-chat-badge')).toHaveLength(0)
    expect(wrapper.findAll('.nl-chat-status')).toHaveLength(0)
    expect(wrapper.findAll('.nl-chat-spinner')).toHaveLength(0)
    expect(wrapper.find('.nl-chat-header').findAll('.dot')).toHaveLength(0)
  })
})

describe('ChatWindow header — info icon', () => {
  it('leads the header and is labelled from i18n', () => {
    const wrapper = mountWindow()
    const header = wrapper.find('.nl-chat-header')

    expect([...(header.element.firstElementChild?.classList ?? [])]).toContain('nl-chat-info')
    const btn = header.find('.nl-chat-info button')
    expect(btn.attributes('title')).toBe('Thông tin context')
    expect(btn.attributes('aria-label')).toBe('Thông tin context')
    // Drawn by the shared icon set, not by a hand-rolled SVG (docs/ui-buttons.md).
    const svg = btn.find('svg')
    expect(svg.attributes('viewBox')).toBe('0 0 24 24')
    // Stroked, not filled — the old inline SVG carried fill/stroke on <svg>,
    // which the shared one does not, so a solid blob is the failure mode.
    expect(svg.find('circle').attributes('fill')).toBe('none')
  })

  it.each([
    [true, 'Dashboard đang kết nối'],
    [false, 'Dashboard mất kết nối'],
  ])('shows the connection state (connected=%s) the dot used to carry', async (connected, text) => {
    const wrapper = mountWindow({ connected })
    await wrapper.find('.nl-chat-info').trigger('pointerenter')

    const popover = wrapper.find('.nl-chat-info-popover')
    expect(popover.text()).toContain('Kết nối')
    expect(popover.text()).toContain(text)
  })

  it('puts the connection row last — it is about the dashboard, not the session', async () => {
    const wrapper = mountWindow({ connected: true })
    await wrapper.find('.nl-chat-info').trigger('pointerenter')

    const labels = wrapper.findAll('.nl-chat-info-label').map((l) => l.text())
    expect(labels[labels.length - 1]).toBe('Kết nối')
  })
})

/**
 * The connection state moved inside this popover, so hover cannot be the only
 * way in — a touch device has no hover at all. `aria-expanded` on the trigger
 * promises a real toggle, and these cover the promise plus every way back out.
 */
describe('ChatWindow header — opening and dismissing the info popover', () => {
  const popoverOf = (w: ReturnType<typeof mountWindow>) => w.find('.nl-chat-info-popover')
  const triggerOf = (w: ReturnType<typeof mountWindow>) => w.find('.nl-chat-info button')

  it('the trigger toggles the popover and reports it through aria-expanded', async () => {
    const wrapper = mountAttached()
    expect(popoverOf(wrapper).exists()).toBe(false)
    expect(triggerOf(wrapper).attributes('aria-expanded')).toBe('false')

    await triggerOf(wrapper).trigger('click')
    expect(popoverOf(wrapper).exists()).toBe(true)
    expect(triggerOf(wrapper).attributes('aria-expanded')).toBe('true')

    await triggerOf(wrapper).trigger('click')
    expect(popoverOf(wrapper).exists()).toBe(false)
    expect(triggerOf(wrapper).attributes('aria-expanded')).toBe('false')
  })

  it('closes a hover-opened popover when the pointer leaves', async () => {
    const wrapper = mountAttached()
    await wrapper.find('.nl-chat-info').trigger('pointerenter')
    expect(popoverOf(wrapper).exists()).toBe(true)

    await wrapper.find('.nl-chat-info').trigger('pointerleave')
    expect(popoverOf(wrapper).exists()).toBe(false)
  })

  it('keeps a clicked-open popover when the pointer leaves', async () => {
    const wrapper = mountAttached()
    await triggerOf(wrapper).trigger('click')

    // Deliberate open beats incidental hover-out: otherwise reading the rows
    // would mean keeping the pointer parked on a 14px icon.
    await wrapper.find('.nl-chat-info').trigger('pointerleave')
    expect(popoverOf(wrapper).exists()).toBe(true)
  })

  it('closes on a click outside the popover', async () => {
    const wrapper = mountAttached()
    await triggerOf(wrapper).trigger('click')
    expect(popoverOf(wrapper).exists()).toBe(true)

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(popoverOf(wrapper).exists()).toBe(false)
  })

  it('closes on Escape and hands focus back to the trigger', async () => {
    const wrapper = mountAttached()
    await triggerOf(wrapper).trigger('click')
    expect(popoverOf(wrapper).exists()).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(popoverOf(wrapper).exists()).toBe(false)
    expect(document.activeElement).toBe(triggerOf(wrapper).element)
  })

  it('drops its document listeners on unmount', async () => {
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')

    mountWindow().unmount()

    const added = add.mock.calls.filter(([type]) => type === 'click' || type === 'keydown').length
    const removed = remove.mock.calls.filter(
      ([type]) => type === 'click' || type === 'keydown',
    ).length
    expect(added).toBeGreaterThan(0)
    expect(removed).toBe(added)

    add.mockRestore()
    remove.mockRestore()
  })
})

describe('ChatWindow header — the + button moved out', () => {
  it('no longer offers a new session from the header', () => {
    const wrapper = mountWindow()
    const titles = wrapper
      .find('.nl-chat-header')
      .findAll('button')
      .map((b) => b.attributes('title'))

    expect(titles).not.toContain('Phiên chat mới')
    // Minimize and close stayed behind.
    expect(titles).toContain('Thu nhỏ')
    expect(titles).toContain('Đóng')
  })
})
