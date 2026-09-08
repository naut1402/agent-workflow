import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mountWithI18n } from '../../../helpers/i18n'
import ChatComposerMenu from '@/features/nl-chat/components/ChatComposerMenu.vue'
import { useChatSurface } from '@/features/nl-chat/composables/useChatSurface'

/**
 * The "+" that used to live in the window header, now at the head of the input
 * row with a menu behind it. Two things make it fragile: it sits inside the
 * composer's `<form>` (a stray submit sends the message), and the pattern it
 * copies its look from — the Statistics add-card button — has no dismissal at
 * all, so every way out of the menu is covered here.
 */

/** Every wrapper `mountInForm` hands out, so `afterEach` can tear them down. */
const mounted: ReturnType<typeof mountWithI18n>[] = []

/** Mounted inside a form, the way the composer really mounts it. */
function mountInForm(props: Record<string, unknown> = {}) {
  const onSubmit = vi.fn((e: Event) => e.preventDefault())
  const picked: File[][] = []

  const Host = defineComponent({
    setup() {
      return () =>
        h('form', { onSubmit }, [
          h(ChatComposerMenu, { ...props, onPick: (files: File[]) => picked.push(files) }),
        ])
    },
  })

  const wrapper = mountWithI18n(Host, { attachTo: document.body })
  mounted.push(wrapper)
  return { wrapper, onSubmit, picked }
}

const menuOf = (wrapper: ReturnType<typeof mountInForm>['wrapper']) =>
  wrapper.find('.nl-chat-composer-menu')
const triggerOf = (wrapper: ReturnType<typeof mountInForm>['wrapper']) =>
  wrapper.find('.nl-chat-composer-add > button')
const itemsOf = (wrapper: ReturnType<typeof mountInForm>['wrapper']) =>
  wrapper.findAll('.nl-chat-composer-menu-item')

/** The session registry is a module singleton — drain what a test pushed. */
function resetSurface(): void {
  const { sessions, activeId, closeSession, openBuilderChat, close } = useChatSurface()
  openBuilderChat()
  const builderId = activeId.value
  for (const s of [...sessions.value]) if (s.id !== builderId) closeSession(s.id)
  close()
}

beforeEach(resetSurface)
afterEach(() => {
  // `attachTo: document.body` leaves the node AND two document listeners behind;
  // unmounting is what runs `onBeforeUnmount` and takes the listeners off again.
  for (const w of mounted.splice(0)) w.unmount()
  vi.restoreAllMocks()
})

describe('ChatComposerMenu — opening and dismissing', () => {
  it('the trigger toggles the menu and reports it through aria-expanded', async () => {
    const { wrapper } = mountInForm()
    expect(menuOf(wrapper).exists()).toBe(false)
    expect(triggerOf(wrapper).attributes('aria-expanded')).toBe('false')

    await triggerOf(wrapper).trigger('click')
    expect(menuOf(wrapper).exists()).toBe(true)
    expect(triggerOf(wrapper).attributes('aria-expanded')).toBe('true')

    await triggerOf(wrapper).trigger('click')
    expect(menuOf(wrapper).exists()).toBe(false)
  })

  it('a click outside closes it', async () => {
    const { wrapper } = mountInForm()
    await triggerOf(wrapper).trigger('click')
    expect(menuOf(wrapper).exists()).toBe(true)

    document.body.click()
    await wrapper.vm.$nextTick()
    expect(menuOf(wrapper).exists()).toBe(false)
  })

  it('Escape closes it and hands focus back to the trigger', async () => {
    const { wrapper } = mountInForm()
    await triggerOf(wrapper).trigger('click')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()

    expect(menuOf(wrapper).exists()).toBe(false)
    expect(document.activeElement).toBe(triggerOf(wrapper).element)
  })

  it('is labelled from i18n — it has no text of its own', () => {
    const { wrapper } = mountInForm()
    expect(triggerOf(wrapper).attributes('title')).toBe('Thêm')
    expect(triggerOf(wrapper).attributes('aria-label')).toBe('Thêm')
  })

  it('never submits the form it lives in', async () => {
    const { wrapper, onSubmit } = mountInForm()
    await triggerOf(wrapper).trigger('click')
    for (const item of itemsOf(wrapper)) await item.trigger('click')

    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('ChatComposerMenu — attaching files', () => {
  it('the attach item opens the file dialog and closes the menu', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const { wrapper } = mountInForm()

    await triggerOf(wrapper).trigger('click')
    await itemsOf(wrapper)[0].trigger('click')

    expect(click).toHaveBeenCalledTimes(1)
    expect(menuOf(wrapper).exists()).toBe(false)
  })

  it('picked files are handed up, and the input is reset so the same file re-fires', async () => {
    const { wrapper, picked } = mountInForm()
    const input = wrapper.find('input[type="file"]')
    const el = input.element as HTMLInputElement

    const files = [new File(['a'], 'note.txt', { type: 'text/plain' })]
    Object.defineProperty(el, 'files', { value: files, configurable: true })
    await input.trigger('change')

    expect(picked).toEqual([files])
    expect(el.value).toBe('')
  })

  it('takes several files in one go', async () => {
    const { wrapper, picked } = mountInForm()
    const input = wrapper.find('input[type="file"]')
    const files = [
      new File(['a'], 'a.txt'),
      new File(['b'], 'b.png', { type: 'image/png' }),
      new File(['c'], 'c.pdf', { type: 'application/pdf' }),
    ]
    Object.defineProperty(input.element, 'files', { value: files, configurable: true })
    await input.trigger('change')

    expect(picked[0].map((f) => f.name)).toEqual(['a.txt', 'b.png', 'c.pdf'])
    // The picker accepts more than one file per turn.
    expect(input.attributes('multiple')).toBeDefined()
  })

  it('a cancelled dialog stages nothing', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const { wrapper, picked } = mountInForm()

    await triggerOf(wrapper).trigger('click')
    await itemsOf(wrapper)[0].trigger('click')

    // Cancelling fires no `change` at all, so nothing is ever handed up.
    expect(picked).toEqual([])
  })
})

describe('ChatComposerMenu — disabled surface', () => {
  it('locks attaching but never the new-session item or the trigger', async () => {
    const { wrapper } = mountInForm({ disabled: true })
    await triggerOf(wrapper).trigger('click')

    const [attach, newSession] = itemsOf(wrapper)
    expect(triggerOf(wrapper).attributes('disabled')).toBeUndefined()
    expect(attach.attributes('disabled')).toBeDefined()
    // A finished flow (or a step with no CLI session) still needs a way out.
    expect(newSession.attributes('disabled')).toBeUndefined()
  })
})

describe('ChatComposerMenu — new session', () => {
  it('pushes a session onto the registry and closes the menu', async () => {
    const { sessions } = useChatSurface()
    const before = sessions.value.length
    const { wrapper } = mountInForm()

    await triggerOf(wrapper).trigger('click')
    await itemsOf(wrapper)[1].trigger('click')

    expect(sessions.value.length).toBe(before + 1)
    expect(menuOf(wrapper).exists()).toBe(false)
  })
})
