import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mountWithI18n } from '../../helpers/i18n'
import { useCopyText } from '@/frontend/composables/useCopyText'

/**
 * `LogsPanel` grew this pattern and `ChatMessageBubble` now shares it, so both
 * call sites depend on the same three behaviours: the Clipboard API path, the
 * `execCommand` fallback for insecure origins, and the flash that clears itself.
 *
 * The composable registers `onUnmounted`, so it needs a real component instance.
 */

function mountCopy(opts?: { flashMs?: number }) {
  let api: ReturnType<typeof useCopyText>
  const Host = defineComponent({
    setup() {
      api = useCopyText(opts)
      return () => h('div')
    },
  })
  const wrapper = mountWithI18n(Host)
  return { wrapper, api: api! }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useCopyText', () => {
  it('writes through the Clipboard API and flashes a confirmation', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    const { api } = mountCopy()
    await api.copyText('nội dung cần copy')

    expect(writeText).toHaveBeenCalledWith('nội dung cần copy')
    expect(api.copyFlash.value).toBeTruthy()
  })

  it('falls back to execCommand when there is no Clipboard API', async () => {
    // Plain http on a LAN IP is not a secure context, so `clipboard` is absent.
    vi.stubGlobal('navigator', {})
    const execCommand = vi.fn(() => true)
    document.execCommand = execCommand as any

    const { api } = mountCopy()
    await api.copyText('qua execCommand')

    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(api.copyFlash.value).toBeTruthy()
    // The scratch textarea must not be left behind in the document.
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
  })

  it('an execCommand fallback that returns false reports a failure', async () => {
    vi.stubGlobal('navigator', {})
    // `execCommand` signals refusal by return value, not by throwing: an
    // unsupported/blocked copy leaves the clipboard untouched and must not
    // flash a confirmation.
    document.execCommand = vi.fn(() => false) as any

    const { api } = mountCopy()
    await api.copyText('execCommand từ chối')

    expect(api.copyFlash.value).toBe('Copy thất bại')
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
  })

  it('an execCommand fallback that throws still removes the scratch textarea', async () => {
    vi.stubGlobal('navigator', {})
    document.execCommand = vi.fn(() => {
      throw new Error('not allowed')
    }) as any

    const { api } = mountCopy()
    await api.copyText('execCommand ném lỗi')

    expect(api.copyFlash.value).toBe('Copy thất bại')
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
  })

  it('reports a failure instead of flashing success', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error('denied')
        }),
      },
    })

    const { api } = mountCopy()
    await api.copyText('sẽ thất bại')
    expect(api.copyFlash.value).toBe('Copy thất bại')
  })

  it('empty text is a no-op — no clipboard call, no flash', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    const { api } = mountCopy()
    await api.copyText('')
    await api.copyText(null as any)

    expect(writeText).not.toHaveBeenCalled()
    expect(api.copyFlash.value).toBe('')
  })

  it('the flash clears itself after the configured delay', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => {}) } })

    const { api } = mountCopy({ flashMs: 500 })
    // Awaited directly: under fake timers a microtask-flush helper cannot
    // advance the clock, so the flash would be asserted before it is even set.
    await api.copyText('có flash')
    expect(api.copyFlash.value).toBeTruthy()

    vi.advanceTimersByTime(500)
    expect(api.copyFlash.value).toBe('')
  })
})
