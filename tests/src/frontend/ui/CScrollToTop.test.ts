import { mountWithI18n as mount } from '../../helpers/i18n'
import { createTestI18nPlugin } from '../../helpers/i18n'
import { mount as rawMount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import CScrollToTop from '@/frontend/ui/CScrollToTop.vue'

/**
 * [Tfe960c47] Nút "lên đầu trang" — nhóm §6 của `test-spec.md`.
 *
 * Hình dạng là *neo sticky cao 0px* đặt cuối vùng cuộn, nên component KHÔNG bọc
 * scroller: nó nhận element cuộn qua prop. Nhờ vậy cùng một component phục vụ
 * cả `.c-md-body` của viewer lẫn `.monitor-content` của trang task.
 *
 * ⚠️ Phần pixel (nút không đè nội dung, không đẩy chiều cao tài liệu) jsdom
 * không trả lời được ⇒ nằm ở §12 kiểm thủ công. Ở đây chỉ chấm cấu trúc.
 */

function makeScroller({ clientHeight = 0 } = {}): HTMLElement {
  const el = document.createElement('div')
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
  document.body.appendChild(el)
  return el
}

async function scrollTo(el: HTMLElement, top: number) {
  el.scrollTop = top
  el.dispatchEvent(new Event('scroll'))
  await nextTick()
}

/** Mount ở trạng thái ĐANG HIỆN: gắn scroller rồi cuộn quá ngưỡng (sàn 200px). */
async function mountVisible(locale?: 'vi' | 'en') {
  const el = makeScroller()
  const w = locale
    ? rawMount(CScrollToTop, {
        props: { scroller: el },
        global: { plugins: [createTestI18nPlugin(locale)] },
      })
    : mount(CScrollToTop, { props: { scroller: el } })
  await nextTick()
  await scrollTo(el, 900)
  return { w, el }
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('CScrollToTop — nút thật, truy cập được (TC-D01, TC-D02, TC-D08)', () => {
  it('TC-D01: là `<button type="button">` native, không phải div gắn role', async () => {
    const { w } = await mountVisible()
    const btn = w.find('.c-scroll-top__btn')

    expect(btn.exists()).toBe(true)
    expect(btn.element.tagName).toBe('BUTTON')
    expect(btn.attributes('type')).toBe('button')
    // Native ⇒ Enter/Space (TC-D04) do trình duyệt lo, không cần handler tay.
    expect(btn.attributes('role')).toBeUndefined()
  })

  it('TC-D02: có cả `aria-label` và `title`, lấy từ i18n', async () => {
    const { w } = await mountVisible()
    const btn = w.find('.c-scroll-top__btn')

    expect(btn.attributes('aria-label')).toBe('Lên đầu trang')
    expect(btn.attributes('title')).toBe('Lên đầu trang')
  })

  it('TC-I03: đổi locale ⇒ nhãn đổi theo, 🚫 không hardcode chuỗi trong template', async () => {
    const { w } = await mountVisible('en')
    const btn = w.find('.c-scroll-top__btn')

    expect(btn.attributes('aria-label')).toBe('Back to top')
    expect(btn.attributes('title')).toBe('Back to top')
  })

  it('TC-D08: render icon mũi tên lên, không ra ô trống', async () => {
    const { w } = await mountVisible()
    const svg = w.find('.c-scroll-top__btn svg')

    expect(svg.exists()).toBe(true)
    expect(svg.attributes('viewBox')).toBe('0 0 16 16')
    expect(svg.html()).toContain('<path')
  })
})

describe('CScrollToTop — hành vi bấm (TC-D03, TC-D04)', () => {
  it('TC-D03: click ⇒ đưa scroller về đầu (fallback `scrollTop = 0` của jsdom)', async () => {
    const { w, el } = await mountVisible()
    await w.find('.c-scroll-top__btn').trigger('click')

    expect(el.scrollTop).toBe(0)
  })

  it('TC-D03b: scroller CÓ `scrollTo` ⇒ dùng đường chính, cuộn mượt', async () => {
    const el = makeScroller()
    const scrollToSpy = vi.fn()
    ;(el as unknown as { scrollTo: unknown }).scrollTo = scrollToSpy
    const w = mount(CScrollToTop, { props: { scroller: el } })
    await nextTick()
    await scrollTo(el, 900)

    await w.find('.c-scroll-top__btn').trigger('click')
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('bấm xong nút tự ẩn — không còn gì để cuộn thì không còn nút', async () => {
    const { w } = await mountVisible()
    await w.find('.c-scroll-top__btn').trigger('click')
    await nextTick()

    expect(w.find('.c-scroll-top__btn').exists()).toBe(false)
  })
})

describe('CScrollToTop — trạng thái ẩn (TC-D05, TC-D06, TC-D07)', () => {
  it('TC-D05 + TC-D06: ẩn ⇒ nút KHÔNG có trong DOM nên không nhận chuột, không vào tab order', async () => {
    const el = makeScroller()
    const w = mount(CScrollToTop, { props: { scroller: el } })
    await nextTick()

    expect(w.find('.c-scroll-top__btn').exists()).toBe(false)
    expect(w.findAll('button')).toHaveLength(0)
  })

  it('TC-D07: neo luôn có mặt và rỗng khi ẩn — không chiếm chỗ cuối tài liệu', async () => {
    const el = makeScroller()
    // `transition: false` ⇒ render `<Transition>` thật thay vì `transition-stub`,
    // để đếm đúng số phần tử mà trình duyệt sẽ thấy trong neo.
    const w = mount(CScrollToTop, {
      props: { scroller: el },
      global: { stubs: { transition: false } },
    })
    await nextTick()

    const anchor = w.find('.c-scroll-top')
    expect(anchor.exists()).toBe(true)
    expect(anchor.element.children).toHaveLength(0)
    expect(anchor.text()).toBe('')
  })

  it('scroller null ⇒ không ném lỗi, chỉ còn neo rỗng', async () => {
    const w = mount(CScrollToTop, { props: { scroller: null } })
    await nextTick()

    expect(w.find('.c-scroll-top').exists()).toBe(true)
    expect(w.find('.c-scroll-top__btn').exists()).toBe(false)
  })
})

/**
 * E16: element scroller KHÔNG đổi khi đổi tài liệu (`.c-md-body` /
 * `.monitor-content` là cùng một node), nên watcher trên `scroller` không bắn.
 * `contentKey` là đường dây duy nhất báo "đo lại ngưỡng đi".
 */
describe('CScrollToTop — prop contentKey (E16)', () => {
  it('đổi contentKey ⇒ đo lại; tài liệu ngắn đi thì nút tự ẩn', async () => {
    const { w, el } = await mountVisible()
    expect(w.find('.c-scroll-top__btn').exists()).toBe(true)

    // Tài liệu mới ngắn hơn: trình duyệt kẹp `scrollTop` về 0 mà không bắn `scroll`.
    el.scrollTop = 0
    await w.setProps({ contentKey: 'doc-khac' })
    await nextTick()
    await nextTick() // component đợi `nextTick` rồi mới đo

    expect(w.find('.c-scroll-top__btn').exists()).toBe(false)
  })

  it('contentKey không đổi ⇒ không tự ẩn nút đang hiện', async () => {
    const { w } = await mountVisible()
    await w.setProps({ contentKey: undefined })
    await nextTick()
    await nextTick()

    expect(w.find('.c-scroll-top__btn').exists()).toBe(true)
  })
})
