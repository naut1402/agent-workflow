<script setup lang="ts">
import { nextTick, toRef, watch } from 'vue'
import Icon from './Icon.vue'
import { useI18nHelpers } from '../composables/useI18nHelpers'
import { useScrollToTop } from '../composables/useScrollToTop'

/**
 * Nút "lên đầu trang" cho một vùng cuộn bất kỳ.
 *
 * Dạng *neo sticky cao 0px* đặt cuối scroller, thay vì bọc scroller trong một
 * container `position: relative`: bọc thêm một tầng flex là đúng cạm bẫy
 * "thiếu `min-height: 0`" của `ui-design-guideline.md` §2.2, và sẽ phải sửa cả
 * `MonitorLayout` lẫn `CScreenLayout`. Neo sticky không đụng cấu trúc layout
 * nào nên cùng một component phục vụ được mọi vùng cuộn.
 */
const props = defineProps<{
  scroller: HTMLElement | null
  /**
   * Khoá nội dung của vùng cuộn — đổi giá trị là tính lại ngưỡng hiện nút.
   *
   * Cần vì element scroller (`.c-md-body` / `.monitor-content`) KHÔNG đổi khi
   * đổi tài liệu, nên watcher trên `scroller` không bắn. Thiếu nó thì chuyển từ
   * tài liệu dài đang cuộn sâu sang tài liệu ngắn, nút vẫn nổi dù không còn gì
   * để cuộn.
   */
  contentKey?: unknown
}>()

const { t } = useI18nHelpers()
const { visible, scrollToTop, update } = useScrollToTop(toRef(props, 'scroller'))

// `nextTick` để DOM đã dựng xong nội dung mới rồi mới đo `scrollTop`/`clientHeight`.
watch(() => props.contentKey, () => nextTick(update))

defineExpose({ visible, update })
</script>

<template>
  <div class="c-scroll-top">
    <Transition name="c-scroll-top-fade">
      <!-- `v-if` chứ không `opacity: 0`: nút ẩn phải thật sự không nhận chuột
           và không nằm trong tab order. -->
      <button
        v-if="visible"
        type="button"
        class="icon-btn c-scroll-top__btn"
        :title="t('common.scrollTop.label')"
        :aria-label="t('common.scrollTop.label')"
        @click="scrollToTop"
      >
        <Icon name="arrowUp" />
      </button>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
/* Neo trong suốt, cao 0px: ngồi cuối vùng cuộn mà không đẩy chiều cao tài liệu. */
.c-scroll-top {
  position: sticky;
  bottom: 0;
  height: 0;
  overflow: visible;
  z-index: 5; /* luôn dưới `.selection-toolbar` (z-index 50) */
  pointer-events: none;
}

/* Viền + nền là ngoại lệ có chủ ý của `.icon-btn` borderless
   (docs/agent-rules/ui-design-guideline.md §1.4): nút nổi đè lên nội dung
   markdown nên phải tách được khỏi nền. */
.c-scroll-top__btn {
  position: absolute;
  right: 12px;
  bottom: 16px;
  pointer-events: auto;
  background: var(--panel-2);
  border: 1px solid var(--border);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}

.c-scroll-top-fade-enter-active,
.c-scroll-top-fade-leave-active {
  transition: opacity 0.15s ease;
}
.c-scroll-top-fade-enter-from,
.c-scroll-top-fade-leave-to {
  opacity: 0;
}
</style>
