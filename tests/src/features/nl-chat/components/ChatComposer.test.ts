import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { mountWithI18n } from '../../../helpers/i18n'
import ChatComposer from '@/features/nl-chat/components/ChatComposer.vue'
import { useChatComposer } from '@/features/nl-chat/composables/useChatComposer'
import { useChatSurface } from '@/features/nl-chat/composables/useChatSurface'
import { useAppSettings } from '@/core/composables/useAppSettings'

/**
 * `useChatComposer` + `ChatComposer.vue` are the halves BuilderChatBody and
 * TaskChatBody used to each carry verbatim, so this is the only place the shared
 * send guard, Enter behaviour and attachment hand-off are covered. Both bodies
 * differ solely in the `canSend` / `send` callbacks, which is what `make()`
 * parametrises.
 *
 * `useChatComposer` calls `useI18nHelpers()`, which needs a real component
 * instance — hence a host component rather than calling the composable bare.
 */

function stubUpload(result: { files?: { name: string; path: string }[]; status?: number }) {
  const fetchMock = vi.fn(async (input: any, init: any = {}) => {
    const url = String(input)
    if (url.includes('/api/nl-chat/attachments')) {
      const status = result.status ?? 201
      return {
        ok: status < 400,
        status,
        json: async () =>
          status < 400 ? { files: result.files ?? [] } : { error: 'upload refused' },
      }
    }
    throw new Error(`unexpected fetch: ${(init.method || 'GET').toUpperCase()} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/**
 * Like `stubUpload`, but the upload never settles until the returned `release`
 * is called — the only way to observe the composer while `uploading` is true.
 */
function stubSlowUpload() {
  let release: (() => void) | null = null
  const started = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any) => {
      if (!String(input).includes('/api/nl-chat/attachments')) {
        throw new Error(`unexpected fetch: ${String(input)}`)
      }
      started()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { ok: true, status: 201, json: async () => ({ files: [] }) }
    }),
  )
  return { started, release: () => release?.() }
}

function make(over: { canSend?: boolean; sending?: boolean } = {}) {
  const sent: string[] = []
  const canSend = ref(over.canSend ?? true)
  const sending = ref(over.sending ?? false)
  let composer: ReturnType<typeof useChatComposer>

  const Host = defineComponent({
    setup() {
      const dropZone = ref<HTMLElement | null>(null)
      composer = useChatComposer({
        dropZone,
        getProjectId: () => 'P1',
        canSend: () => canSend.value,
        sending: () => sending.value,
        send: (text) => sent.push(text),
      })
      return () => h('div', { ref: dropZone }, [
        h(ChatComposer, { composer, placeholder: 'Nhập tin nhắn...' }),
      ])
    },
  })

  const wrapper = mountWithI18n(Host, { attachTo: document.body })
  return { wrapper, sent, canSend, sending, composer: composer!, textarea: wrapper.find('textarea'), button: wrapper.find('button[type="submit"]') }
}

/**
 * jsdom ships no `DataTransfer`, and `useDropZone` only ever reads
 * `dataTransfer.files` — so a plain object standing in for it is enough.
 */
function dropFile(zone: HTMLElement, file: File): void {
  const ev = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } })
  zone.dispatchEvent(ev)
}

/** A chip the composer will upload — `File` is enough, nothing reads the bytes. */
function pngChip(name = 'shot.png'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })
}

beforeEach(() => {
  // The settings store is a module singleton; reset the Enter preference so an
  // earlier test's `update()` cannot leak into the next one.
  useAppSettings().update({ chatEnterToSend: true })
  // Same for the session registry, which the "+" menu's new-session item writes to.
  const { sessions, activeId, closeSession, openBuilderChat, close } = useChatSurface()
  openBuilderChat()
  const builderId = activeId.value
  for (const s of [...sessions.value]) if (s.id !== builderId) closeSession(s.id)
  close()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ChatComposer — send guard', () => {
  it('an empty composer cannot submit', () => {
    const { button } = make()
    expect(button.attributes('disabled')).toBeDefined()
  })

  it('typing enables submit, and sending clears the box', async () => {
    const { textarea, button, sent, wrapper } = make()
    await textarea.setValue('dựng task cho tôi')
    expect(button.attributes('disabled')).toBeUndefined()

    await button.trigger('submit')
    await wrapper.vm.$nextTick()

    expect(sent).toEqual(['dựng task cho tôi'])
    expect((textarea.element as HTMLTextAreaElement).value).toBe('')
  })

  it('whitespace alone is not a message', async () => {
    const { textarea, button } = make()
    await textarea.setValue('   \n  ')
    expect(button.attributes('disabled')).toBeDefined()
  })

  it('a surface that refuses input disables the box, and re-enables without a remount', async () => {
    const { textarea, button, canSend, wrapper } = make()
    await textarea.setValue('có nội dung')
    expect(button.attributes('disabled')).toBeUndefined()

    // The surface stops accepting input (flow finished / step has no CLI session).
    canSend.value = false
    await wrapper.vm.$nextTick()
    expect(textarea.attributes('disabled')).toBeDefined()
    expect(button.attributes('disabled')).toBeDefined()

    canSend.value = true
    await wrapper.vm.$nextTick()
    expect(button.attributes('disabled')).toBeUndefined()
  })

  it('a turn already in flight blocks a second send', async () => {
    const { textarea, button, sending, wrapper } = make()
    await textarea.setValue('gửi lần hai')

    sending.value = true
    await wrapper.vm.$nextTick()
    expect(button.attributes('disabled')).toBeDefined()
  })
})

describe('ChatComposer — Enter behaviour', () => {
  /**
   * Whether Enter inserts a newline is the browser's decision, and it hinges on
   * one thing only: did the handler call `preventDefault`? jsdom never performs
   * that insertion, so `defaultPrevented` on the dispatched event is what has to
   * be asserted — reading the textarea's value back would pass either way.
   */
  function pressEnter(textarea: any): KeyboardEvent {
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    ;(textarea.element as HTMLTextAreaElement).dispatchEvent(ev)
    return ev
  }

  it('Enter sends when the setting says so', async () => {
    const { textarea, sent, wrapper } = make()
    await textarea.setValue('gửi bằng Enter')
    const ev = pressEnter(textarea)
    await wrapper.vm.$nextTick()

    expect(sent).toEqual(['gửi bằng Enter'])
    // preventDefault → no stray newline left in the box after the send.
    expect(ev.defaultPrevented).toBe(true)
  })

  it('Enter inserts a newline instead when the setting is off', async () => {
    useAppSettings().update({ chatEnterToSend: false })
    const { textarea, sent, wrapper } = make()
    await textarea.setValue('xuống hàng thôi')
    const ev = pressEnter(textarea)
    await wrapper.vm.$nextTick()

    expect(sent).toEqual([])
    // No preventDefault → the browser's own newline insertion stands.
    expect(ev.defaultPrevented).toBe(false)
  })

  it('Enter committing an IME word never sends', async () => {
    const { textarea, sent, wrapper } = make()
    await textarea.setValue('tiếng Việt')
    await textarea.trigger('keydown', { key: 'Enter', isComposing: true })
    await wrapper.vm.$nextTick()
    expect(sent).toEqual([])
  })

  it('Ctrl+Enter sends even with Enter-to-send turned off', async () => {
    useAppSettings().update({ chatEnterToSend: false })
    const { textarea, sent, wrapper } = make()
    await textarea.setValue('ctrl enter')
    await textarea.trigger('keydown', { key: 'Enter', ctrlKey: true })
    await wrapper.vm.$nextTick()
    expect(sent).toEqual(['ctrl enter'])
  })
})

describe('ChatComposer — input row layout', () => {
  it('opens on two lines', () => {
    const { textarea } = make()
    // jsdom does not lay out, so this is the attribute half of the two-line
    // floor; the CSS min-height half is pinned by the e2e suite.
    expect(textarea.attributes('rows')).toBe('2')
  })

  it('leads the row with the add menu, and keeps no standalone paperclip', async () => {
    const { wrapper } = make()
    const row = wrapper.find('.nl-chat-input-row')

    expect([...row.element.firstElementChild!.classList]).toContain('nl-chat-composer-add')
    // The attach action is reachable, but only from inside the menu.
    expect(wrapper.findAll('.nl-chat-composer-menu-item')).toHaveLength(0)
    await row.find('.nl-chat-composer-add > button').trigger('click')
    expect(wrapper.findAll('.nl-chat-composer-menu-item').map((i) => i.text())).toEqual([
      'Đính kèm tập tin',
      'Phiên chat mới',
    ])
  })

  it('hides the attachment strip until something is staged', async () => {
    const { wrapper, composer } = make()
    expect(wrapper.findAll('.nl-chat-attach')).toHaveLength(0)

    composer.attachments.add([pngChip()])
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.nl-chat-attach')).toHaveLength(1)
  })
})

describe('ChatComposer — attachments', () => {
  it('a file picked through the + menu is staged as a chip', async () => {
    const { wrapper, composer } = make()
    await wrapper.find('.nl-chat-composer-add > button').trigger('click')

    const input = wrapper.find('input[type="file"]')
    const files = [new File(['x'], 'note.txt', { type: 'text/plain' })]
    Object.defineProperty(input.element, 'files', { value: files, configurable: true })
    await input.trigger('change')

    expect(composer.attachments.items.value.map((i) => i.file.name)).toEqual(['note.txt'])
    expect(wrapper.find('.nl-chat-chip-name').text()).toBe('note.txt')
  })

  it('a staged chip can be removed again', async () => {
    const { wrapper, composer } = make()
    composer.attachments.add([pngChip('a.png'), pngChip('b.png')])
    await wrapper.vm.$nextTick()

    await wrapper.findAll('.nl-chat-chip button')[0].trigger('click')
    expect(composer.attachments.items.value.map((i) => i.file.name)).toEqual(['b.png'])
  })

  it('uploaded paths are appended to the message and the chips are cleared', async () => {
    stubUpload({ files: [{ name: 'shot.png', path: '/root/tasks/T1/attachments/u/shot.png' }] })
    const { textarea, button, sent, composer, wrapper } = make()

    composer.attachments.add([pngChip()])
    await textarea.setValue('xem ảnh này')
    await button.trigger('submit')
    await flushPromises()

    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('xem ảnh này')
    expect(sent[0]).toContain('- shot.png → /root/tasks/T1/attachments/u/shot.png')
    expect(composer.attachments.items.value).toEqual([])
  })

  it('a chip with no text is still sendable', async () => {
    stubUpload({ files: [{ name: 'a.png', path: '/root/uploads/chat/u/a.png' }] })
    const { button, composer, wrapper } = make()

    composer.attachments.add([pngChip('a.png')])
    await wrapper.vm.$nextTick()
    expect(button.attributes('disabled')).toBeUndefined()

    await button.trigger('submit')
    await flushPromises()
    expect(composer.attachments.items.value).toEqual([])
  })

  /**
   * `upload()` snapshots the list it is sending, so anything staged after it
   * starts is never uploaded — yet `onSend` clears every chip once the send
   * completes. The file simply disappears, with no error shown anywhere, which
   * is why the whole strip closes for the duration instead.
   */
  it('attachment editing is locked while an upload is in flight', async () => {
    const { release } = stubSlowUpload()
    const { textarea, button, composer, wrapper } = make()

    composer.attachments.add([pngChip('đang-lên.png')])
    await textarea.setValue('kèm ảnh')
    void button.trigger('submit')
    await flushPromises()

    expect(composer.attachments.uploading.value).toBe(true)
    expect(composer.canAttach.value).toBe(false)
    expect(textarea.attributes('disabled')).toBeDefined()
    expect(wrapper.find('.nl-chat-chip button').attributes('disabled')).toBeDefined()

    // The "+" trigger itself stays live — "new session" must remain reachable —
    // but its attach item does not.
    await wrapper.find('.nl-chat-composer-add > button').trigger('click')
    expect(wrapper.find('.nl-chat-composer-menu-item').attributes('disabled')).toBeDefined()

    release()
    await flushPromises()
  })

  it('a dropped file is staged as a chip', async () => {
    const { composer, wrapper } = make()
    // The drop listener binds on a post-flush tick, so a drop dispatched
    // before it would silently hit nothing and make the guard cases below
    // pass for the wrong reason.
    await flushPromises()

    dropFile(wrapper.element as HTMLElement, pngChip('kéo-thả.png'))
    await flushPromises()

    expect(composer.attachments.items.value.map((i) => i.file.name)).toEqual(['kéo-thả.png'])
  })

  it('a file dropped mid-upload is not silently swallowed', async () => {
    const { release } = stubSlowUpload()
    const { textarea, button, composer, wrapper } = make()

    composer.attachments.add([pngChip('đang-lên.png')])
    await textarea.setValue('kèm ảnh')
    void button.trigger('submit')
    await flushPromises()

    dropFile(wrapper.element as HTMLElement, pngChip('muộn.png'))
    await flushPromises()

    // Refused outright rather than staged into a list that is about to be cleared.
    expect(composer.attachments.items.value.map((i) => i.file.name)).not.toContain('muộn.png')

    release()
    await flushPromises()
  })

  it('clicking a disabled chip remove button does not drop the file', async () => {
    const { release } = stubSlowUpload()
    const { textarea, button, composer, wrapper } = make()

    composer.attachments.add([pngChip('đang-lên.png')])
    await textarea.setValue('kèm ảnh')
    void button.trigger('submit')
    await flushPromises()

    // Not only the DOM attribute: the handler itself refuses, so a
    // programmatic click cannot take a file out from under the upload.
    await wrapper.find('.nl-chat-chip button').trigger('click')
    expect(composer.attachments.items.value.map((i) => i.file.name)).toEqual(['đang-lên.png'])

    release()
    await flushPromises()
  })

  it('a failed upload keeps the text AND the chips so it can be retried', async () => {
    stubUpload({ status: 413 })
    const { textarea, button, sent, composer, wrapper } = make()

    composer.attachments.add([pngChip()])
    await textarea.setValue('thử lại được')
    await button.trigger('submit')
    await flushPromises()

    expect(sent).toEqual([])
    expect((textarea.element as HTMLTextAreaElement).value).toBe('thử lại được')
    expect(composer.attachments.items.value).toHaveLength(1)
    expect(composer.attachments.error.value).toBeTruthy()
  })
})
