<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import Icon from './Icon.vue'
import { useI18nHelpers } from '../composables/useI18nHelpers'

// xem docs/architecture/code/frontend.md §1
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
      if (visible.value) return
      showTimer = setTimeout(() => {
        showTimer = null
        visible.value = true
        shownAt = Date.now()
      }, props.delayMs)
    } else {
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
  <div
    v-if="active || visible"
    class="c-loading-overlay"
    :class="{ 'is-visible': visible }"
    aria-busy="true"
  >
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
  // xem docs/architecture/code/frontend.md §1
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
