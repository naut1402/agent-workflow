import { onUnmounted, ref, watch, type Ref } from 'vue'

export interface ScrollToTopOptions {
  /** Ngưỡng hiện nút, px. Bỏ trống ⇒ một màn hình của chính scroller (`clientHeight`), sàn 200px. */
  threshold?: () => number | undefined
}

/**
 * Theo dõi độ cuộn của một vùng cuộn và đưa nó về đầu.
 *
 * Tách khỏi component để unit-test được không cần mount, và để cùng một lõi
 * phục vụ cả `.c-md-body` của viewer lẫn `.monitor-content` của trang task.
 */
export function useScrollToTop(
  scroller: Ref<HTMLElement | null | undefined>,
  options: ScrollToTopOptions = {},
) {
  const visible = ref(false)

  // `scrollTop` / `clientHeight` là đọc thuần, không ghi, nên không ép reflow —
  // không cần rAF, và bỏ rAF giữ cho test xác định được kết quả ngay sau `scroll`.
  function update() {
    const el = scroller.value
    if (!el) {
      visible.value = false
      return
    }
    const limit = options.threshold?.() ?? Math.max(el.clientHeight, 200)
    visible.value = el.scrollTop > limit
  }

  function scrollToTop() {
    const el = scroller.value
    if (!el) return
    // `prefers-reduced-motion` là Baseline widely available (từ 2020) nên đọc
    // thẳng; `?.` là để jsdom — môi trường test không cài `window.matchMedia`.
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
    // jsdom cũng không cài `scrollTo` cho Element — thiếu fallback là test ném lỗi.
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
    } else {
      el.scrollTop = 0
    }
    update()
  }

  // Gắn/gỡ listener theo chính element chứ không theo vòng đời component:
  // `scroller` là template ref nên null ở lần chạy đầu.
  watch(
    scroller,
    (el, prev) => {
      prev?.removeEventListener('scroll', update)
      el?.addEventListener('scroll', update, { passive: true })
      update()
    },
    { immediate: true, flush: 'post' },
  )

  onUnmounted(() => scroller.value?.removeEventListener('scroll', update))

  return { visible, scrollToTop, update }
}
