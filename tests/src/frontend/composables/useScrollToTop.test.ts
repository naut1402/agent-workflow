import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref, type Ref } from 'vue'
import { useScrollToTop, type ScrollToTopOptions } from '@/frontend/composables/useScrollToTop'

/**
 * [Tfe960c47] Lõi "lên đầu trang" — nhóm §5 của `test-spec.md`.
 *
 * Ba bất biến môi trường đã đo trên repo và nhóm này dựa vào (test-spec §2.1):
 * - jsdom KHÔNG có `Element.prototype.scrollTo` ⇒ nhánh chạy mặc định là
 *   fallback `scrollTop = 0`; muốn chấm đường chính thì phải tự gán stub.
 * - jsdom KHÔNG có layout ⇒ `clientHeight === 0`, nên ngưỡng mặc định rơi về
 *   sàn 200px. 🚫 Không assert vị trí pixel.
 * - jsdom KHÔNG có `window.matchMedia` ⇒ phải stub mới chấm được reduced-motion.
 */

/** Composable gắn `onUnmounted` ⇒ phải sống trong một component thật. */
function withScrollToTop(options?: ScrollToTopOptions) {
  const scroller: Ref<HTMLElement | null> = ref(null)
  let api!: ReturnType<typeof useScrollToTop>
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useScrollToTop(scroller, options)
        return () => h('div')
      },
    }),
  )
  return { scroller, wrapper, get api() { return api } }
}

/** Element cuộn giả: jsdom không có layout nên `clientHeight` phải tự khai. */
function makeScroller({ clientHeight = 0, scrollHeight = 5000 } = {}): HTMLElement {
  const el = document.createElement('div')
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  document.body.appendChild(el)
  return el
}

/** Cuộn như trình duyệt: đổi `scrollTop` rồi bắn `scroll`. */
async function scrollTo(el: HTMLElement, top: number) {
  el.scrollTop = top
  el.dispatchEvent(new Event('scroll'))
  await nextTick()
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('useScrollToTop — cờ hiển thị (TC-C01…C05)', () => {
  it('TC-C01: chưa cuộn ⇒ ẩn', async () => {
    const h = withScrollToTop()
    h.scroller.value = makeScroller()
    await nextTick()
    expect(h.api.visible.value).toBe(false)
  })

  it('TC-C02: cuộn quá ngưỡng ⇒ hiện', async () => {
    const h = withScrollToTop()
    const el = makeScroller()
    h.scroller.value = el
    await nextTick()

    await scrollTo(el, 400)
    expect(h.api.visible.value).toBe(true)
  })

  /**
   * TC-C03: biên phải XÁC ĐỊNH — hiện thực chọn `scrollTop > limit` (nghiêm
   * ngặt), nên đúng ngưỡng là CHƯA hiện. Chấm cả ba điểm để không ai đổi chiều
   * so sánh mà suite vẫn xanh.
   */
  it('TC-C03: biên ngưỡng nhất quán — chỉ VƯỢT ngưỡng mới hiện', async () => {
    const h = withScrollToTop({ threshold: () => 300 })
    const el = makeScroller()
    h.scroller.value = el
    await nextTick()

    await scrollTo(el, 299)
    expect(h.api.visible.value).toBe(false)
    await scrollTo(el, 300)
    expect(h.api.visible.value).toBe(false)
    await scrollTo(el, 301)
    expect(h.api.visible.value).toBe(true)
  })

  it('ngưỡng mặc định là một màn hình của chính scroller, sàn 200px', async () => {
    const h = withScrollToTop()
    const el = makeScroller({ clientHeight: 800 })
    h.scroller.value = el
    await nextTick()

    await scrollTo(el, 800)
    expect(h.api.visible.value).toBe(false)
    await scrollTo(el, 801)
    expect(h.api.visible.value).toBe(true)
  })

  it('sàn 200px áp khi scroller chưa có layout (clientHeight = 0)', async () => {
    const h = withScrollToTop()
    const el = makeScroller({ clientHeight: 0 })
    h.scroller.value = el
    await nextTick()

    await scrollTo(el, 200)
    expect(h.api.visible.value).toBe(false)
    await scrollTo(el, 201)
    expect(h.api.visible.value).toBe(true)
  })

  it('TC-C04: cuộn ngược lên đầu ⇒ ẩn lại', async () => {
    const h = withScrollToTop()
    const el = makeScroller()
    h.scroller.value = el
    await nextTick()

    await scrollTo(el, 900)
    expect(h.api.visible.value).toBe(true)
    await scrollTo(el, 0)
    expect(h.api.visible.value).toBe(false)
  })

  it('TC-C05: tài liệu ngắn (scrollHeight === clientHeight) ⇒ không bao giờ hiện', async () => {
    const h = withScrollToTop()
    const el = makeScroller({ clientHeight: 600, scrollHeight: 600 })
    h.scroller.value = el
    await nextTick()

    // Không cuộn được ⇒ `scrollTop` đứng yên ở 0 dù `scroll` có bắn.
    await scrollTo(el, 0)
    expect(h.api.visible.value).toBe(false)
  })
})

describe('useScrollToTop — đưa về đầu (TC-C06, TC-C07, TC-C12)', () => {
  it('TC-C06: element CÓ `scrollTo` ⇒ gọi với top 0 và behavior smooth', async () => {
    const h = withScrollToTop()
    const el = makeScroller()
    const scrollToSpy = vi.fn()
    ;(el as unknown as { scrollTo: unknown }).scrollTo = scrollToSpy
    h.scroller.value = el
    await nextTick()

    await scrollTo(el, 900)
    h.api.scrollToTop()

    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('TC-C07: element KHÔNG có `scrollTo` (mặc định jsdom) ⇒ fallback scrollTop = 0', async () => {
    const h = withScrollToTop()
    const el = makeScroller()
    h.scroller.value = el
    await nextTick()

    await scrollTo(el, 900)
    expect(() => h.api.scrollToTop()).not.toThrow()

    expect(el.scrollTop).toBe(0)
    expect(h.api.visible.value).toBe(false) // `scrollToTop` đo lại ngay, không đợi `scroll`
  })

  it('TC-C12: `prefers-reduced-motion: reduce` ⇒ behavior "auto"', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query }))
    const h = withScrollToTop()
    const el = makeScroller()
    const scrollToSpy = vi.fn()
    ;(el as unknown as { scrollTo: unknown }).scrollTo = scrollToSpy
    h.scroller.value = el
    await nextTick()

    h.api.scrollToTop()
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
  })

  it('TC-C12b: không reduce ⇒ vẫn smooth; thiếu hẳn `matchMedia` cũng không ném lỗi', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }))
    const h = withScrollToTop()
    const el = makeScroller()
    const scrollToSpy = vi.fn()
    ;(el as unknown as { scrollTo: unknown }).scrollTo = scrollToSpy
    h.scroller.value = el
    await nextTick()

    h.api.scrollToTop()
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })
})

describe('useScrollToTop — vòng đời scroller (TC-C08…C11)', () => {
  it('TC-C08: tham chiếu null ⇒ không ném lỗi, về-đầu là no-op, gắn được sau', async () => {
    const h = withScrollToTop()
    expect(h.api.visible.value).toBe(false)
    expect(() => h.api.scrollToTop()).not.toThrow()

    const el = makeScroller()
    h.scroller.value = el
    await nextTick()
    await scrollTo(el, 900)
    expect(h.api.visible.value).toBe(true)
  })

  it('scroller về lại null ⇒ cờ tắt, không ném lỗi', async () => {
    const h = withScrollToTop()
    const el = makeScroller()
    h.scroller.value = el
    await nextTick()
    await scrollTo(el, 900)
    expect(h.api.visible.value).toBe(true)

    h.scroller.value = null
    await nextTick()
    expect(h.api.visible.value).toBe(false)
  })

  it('TC-C09: đổi scroller ⇒ gỡ listener khỏi element cũ, gắn vào element mới', async () => {
    const h = withScrollToTop()
    const first = makeScroller()
    h.scroller.value = first
    await nextTick()

    const second = makeScroller()
    h.scroller.value = second
    await nextTick()

    // Element cũ cuộn sâu nhưng không còn ai nghe.
    await scrollTo(first, 2000)
    expect(h.api.visible.value).toBe(false)

    await scrollTo(second, 900)
    expect(h.api.visible.value).toBe(true)
  })

  it('TC-C10: unmount ⇒ bắn `scroll` không đổi cờ, không ném lỗi', async () => {
    const h = withScrollToTop()
    const el = makeScroller()
    h.scroller.value = el
    await nextTick()

    h.wrapper.unmount()

    el.scrollTop = 2000
    expect(() => el.dispatchEvent(new Event('scroll'))).not.toThrow()
    await nextTick()
    expect(h.api.visible.value).toBe(false)
  })

  it('TC-C11: hai instance độc lập — cuộn element 1 không đụng cờ của instance 2', async () => {
    const a = withScrollToTop()
    const b = withScrollToTop()
    const elA = makeScroller()
    const elB = makeScroller()
    a.scroller.value = elA
    b.scroller.value = elB
    await nextTick()

    await scrollTo(elA, 900)
    expect(a.api.visible.value).toBe(true)
    expect(b.api.visible.value).toBe(false)
  })

  it('`update()` đo lại ngay mà không cần sự kiện `scroll` — đường dây của prop contentKey (E16)', async () => {
    const h = withScrollToTop()
    const el = makeScroller()
    h.scroller.value = el
    await nextTick()

    await scrollTo(el, 900)
    expect(h.api.visible.value).toBe(true)

    // Tài liệu ngắn đi: nội dung mới làm trình duyệt kẹp `scrollTop` về 0 mà
    // KHÔNG bắn `scroll` nào — chỉ `update()` mới phát hiện được.
    el.scrollTop = 0
    h.api.update()
    expect(h.api.visible.value).toBe(false)
  })
})
