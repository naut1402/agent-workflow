<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { clampChartHeight } from '../lib/mermaidChart'
import { TILE_MIN_SPAN, TILE_MAX_SPAN } from '../lib/chartConfig'

/**
 * Vật chứa một chart trong gallery grid 4 cột: sở hữu grid span (1-4), chiều
 * cao card, overlay button group (settings / remove + zoom-fullscreen của
 * mermaid toolbar — hiện khi hover) và handle kéo góc đổi span + height.
 * Nội dung chart là slot (ChartCard).
 */
const props = withDefaults(
  defineProps<{
    span: number
    height: number
    /** Ẩn nút remove khi gallery chỉ còn 1 chart. */
    removable?: boolean
  }>(),
  { removable: false },
)

const emit = defineEmits<{
  resize: [span: number, height: number]
  settings: []
  remove: []
}>()

const { t } = useI18nHelpers()

/** Preview trong lúc kéo — áp trực tiếp style, commit khi thả. */
const dragPreview = ref<{ span: number; height: number } | null>(null)

const tileStyle = computed(() => {
  const span = dragPreview.value?.span ?? props.span
  return {
    gridColumn: `span ${span} / span ${span}`,
    height: `${dragPreview.value?.height ?? props.height}px`,
  }
})

// Kéo handle: ngang → đổi grid span (snap theo cột), dọc → đổi height px.
// Listener trên window (pointer capture tổng hợp không đảm bảo — xem ChartCard cũ).
let stopDrag: (() => void) | null = null
const handleRef = ref<HTMLElement | null>(null)

function onResizeStart(down: PointerEvent) {
  const handle = handleRef.value
  if (!handle || stopDrag) return
  const grid = handle.closest('.statistics-charts') as HTMLElement | null
  const colWidth = gridColumnWidth(grid)
  const start = { x: down.clientX, y: down.clientY, span: props.span, height: props.height, width: colWidth * props.span }
  try {
    handle.setPointerCapture?.(down.pointerId)
  } catch {
    // PointerId tổng hợp có thể bị từ chối — window listener là nguồn sự thật.
  }

  const onMove = (move: PointerEvent) => {
    const desiredWidth = start.width + (move.clientX - start.x)
    const gap = 12
    const span = Math.max(
      TILE_MIN_SPAN,
      Math.min(TILE_MAX_SPAN, Math.round((desiredWidth + gap) / (colWidth + gap))),
    )
    dragPreview.value = {
      span,
      height: clampChartHeight(start.height + (move.clientY - start.y)),
    }
  }
  const onUp = () => {
    stopDrag?.()
    const final = dragPreview.value
    dragPreview.value = null
    if (final && (final.span !== props.span || final.height !== props.height)) {
      emit('resize', final.span, final.height)
    }
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
  stopDrag = () => {
    stopDrag = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
  }
}

/** Bề rộng 1 cột grid từ container thật (repeat(4, 1fr) + gap 12). */
function gridColumnWidth(grid: HTMLElement | null): number {
  if (!grid) return 240
  const gap = 12
  return Math.max(80, (grid.clientWidth - 3 * gap) / 4)
}

onBeforeUnmount(() => {
  stopDrag?.()
})
</script>

<template>
  <div class="chart-tile" :style="tileStyle">
    <div class="chart-tile-actions">
      <button
        type="button"
        class="icon-btn"
        :title="t('statistics.settings.open')"
        :aria-label="t('statistics.settings.open')"
        @click.stop="emit('settings')"
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-dasharray="1.9 2.24" />
          <circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.25" />
        </svg>
      </button>
      <button
        v-if="removable"
        type="button"
        class="icon-btn"
        :title="t('statistics.removeChart')"
        :aria-label="t('statistics.removeChart')"
        @click.stop="emit('remove')"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
    <div class="chart-tile-content">
      <slot />
    </div>
    <span
      ref="handleRef"
      class="chart-resize-handle"
      role="separator"
      :title="t('statistics.settings.resizeHint')"
      @pointerdown="onResizeStart"
    />
  </div>
</template>

<style scoped lang="scss">
.chart-tile {
  position: relative;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  padding: 0.5rem 0.5rem 0.6rem;
  min-width: 0;
}
/* Overlay button group — chỉ HIỆN khi hover chart; pointer-events giữ auto
   (để tool click được ngay cả khi opacity 0 — hit-target không bị svg chặn). */
.chart-tile-actions {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 3;
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-2);
  opacity: 0;
  transition: opacity 0.12s ease;
}
.chart-tile:hover .chart-tile-actions,
.chart-tile:focus-within .chart-tile-actions {
  opacity: 1;
}
.chart-tile-content {
  height: 100%;
  min-height: 0;
}
.chart-resize-handle {
  position: absolute;
  right: 2px;
  bottom: 2px;
  z-index: 2;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  border-right: 3px solid var(--muted);
  border-bottom: 3px solid var(--muted);
  border-bottom-right-radius: 3px;
  opacity: 0.65;
  touch-action: none;
}
.chart-resize-handle:hover {
  opacity: 1;
  border-color: var(--accent);
}
</style>
