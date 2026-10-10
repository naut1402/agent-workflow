<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import Icon from './Icon.vue'
import { useI18nHelpers } from '../composables/useI18nHelpers'

/**
 * Overlay chặn thao tác trong lúc một action API đang chạy.
 *
 * HỢP ĐỒNG: phần tử cha PHẢI có `position: relative` — overlay là
 * `position: absolute; inset: 0` nên cha không tạo containing block thì nó
 * phủ nhầm lên tổ tiên định vị gần nhất (cùng kiểu hợp đồng `.modal` ↔
 * `.modal-body` ghi ở `_shell.scss`).
 *
 * Trong dialog: đặt vào `.modal-body`, KHÔNG đặt vào `.modal` — để `.modal-head`
 * (nút đóng) và `.modal-foot` không bị phủ, người dùng vẫn thoát được. Nút ở
 * `.modal-foot` chặn bằng `:disabled`, không bằng overlay.
 *
 * CHẶN và VẼ là hai mốc thời gian tách rời: node chặn con trỏ có mặt từ ms 0,
 * scrim + icon xoay chỉ hiện sau `delayMs`. Gộp thành một `v-if="visible"` là
 * để hở một khe `delayMs` mà click vẫn lọt xuống nội dung bên dưới.
 */
const props = withDefaults(
  defineProps<{
    /** Cờ `pending` của `useApiAction`. */
    active: boolean
    /** Nhãn ghi đè; mặc định `common.loadingOverlay.label`. */
    label?: string
    /** Trễ trước khi VẼ, chống nháy với request nhanh. Chặn thì luôn tức thì. */
    delayMs?: number
    /** Đã vẽ thì giữ tối thiểu bấy nhiêu, chống chớp. */
    minVisibleMs?: number
  }>(),
  { label: '', delayMs: 150, minVisibleMs: 300 },
)

const { t } = useI18nHelpers()
const visible = ref(false)

let showTimer: ReturnType<typeof setTimeout> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
let shownAt = 0

function clearTimers(): void {
  if (showTimer) {
    clearTimeout(showTimer)
    showTimer = null
  }
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

watch(
  () => props.active,
  (on) => {
    clearTimers()
    if (on) {
      // Còn đang vẽ từ lượt trước (hideTimer vừa bị huỷ) thì giữ nguyên,
      // không đếm lại delay — nếu không hai action liên tiếp sẽ nháy.
      if (visible.value) return
      showTimer = setTimeout(() => {
        showTimer = null
        visible.value = true
        shownAt = Date.now()
      }, props.delayMs)
    } else {
      // Chưa kịp vẽ thì không có gì để ẩn — đây là đường đi của request nhanh.
      if (!visible.value) return
      const remain = props.minVisibleMs - (Date.now() - shownAt)
      if (remain <= 0) {
        visible.value = false
      } else {
        hideTimer = setTimeout(() => {
          hideTimer = null
          visible.value = false
        }, remain)
      }
    }
  },
  { immediate: true },
)

onUnmounted(clearTimers)
</script>

<template>
  <!-- `active || visible`: node chặn có mặt ngay, scrim/icon đợi `is-visible`. -->
  <div
    v-if="active || visible"
    class="c-loading-overlay"
    :class="{ 'is-visible': visible }"
    aria-busy="true"
  >
    <!-- `role="status"` chỉ gắn ở node bên trong (xuất hiện cùng `visible`) để
         screen reader không bị đọc cho mọi action 20 ms. `<svg>` của Icon.vue
         đã `aria-hidden` nên phần text là nguồn thông báo duy nhất. -->
    <div v-if="visible" class="c-loading-overlay-inner" role="status">
      <Icon name="spinner" :size="20" class="c-spin" />
      <span class="c-loading-overlay-text">{{ label || t('common.loadingOverlay.label') }}</span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.c-loading-overlay {
  position: absolute;
  inset: 0;
  /* Thang CỤC BỘ, cố ý nhỏ: overlay nằm TRONG stacking context của dialog nên
     không cần vượt `.modal-backdrop` (1000) hay `.nested-backdrop` (1100).
     Nâng lên thang toàn cục là overlay của dialog dưới phủ lên dialog lồng. */
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  transition: background 120ms linear;
  cursor: progress;
}

.c-loading-overlay.is-visible {
  background: var(--overlay-scrim);
}

.c-loading-overlay-inner {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: 13px;
}
</style>
