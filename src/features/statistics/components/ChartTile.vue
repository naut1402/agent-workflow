<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { TILE_MIN_SPAN, TILE_MAX_SPAN, snapChartHeight } from '../lib/chartConfig'

/**
 * Vật chứa một chart trong gallery grid 4 cột: sở hữu grid span (1-4), chiều
 * cao card (snap bước 20px), MỘT action group duy nhất (settings / remove /
 * zoom in-out-reset) đi theo con trỏ chuột trong tile và ẩn khi rời khỏi
 * chart. Zoom áp CSS transform lên nội dung — tràn thì scroll ngang/dọc.
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

// ── Action group đi theo con trỏ ────────────────────────────────────────────
const tileRef = ref<HTMLElement | null>(null)
const groupPos = ref({ x: 0, y: 0 })
const groupVisible = ref(false)
const GROUP_OFFSET = { x: 14, y: 14 }

function onPointerMove(move: PointerEvent) {
  const tile = tileRef.value
  if (!tile) return
  const rect = tile.getBoundingClientRect()
  groupPos.value = {
    x: Math.min(Math.max(move.clientX - rect.left + GROUP_OFFSET.x, 4), Math.max(4, rect.width - 160)),
    y: Math.min(Math.max(move.clientY - rect.top + GROUP_OFFSET.y, 4), Math.max(4, rect.height - 36)),
  }
  groupVisible.value = true
}

function onPointerLeave() {
  groupVisible.value = false
}

const groupStyle = computed(() => ({
  left: `${groupPos.value.x}px`,
  top: `${groupPos.value.y}px`,
  opacity: groupVisible.value ? 1 : 0,
}))

// ── Zoom nội dung chart ─────────────────────────────────────────────────────
const ZOOM_MIN = 0.5
const ZOOM_MAX = 3
const zoom = ref(1)

function zoomBy(delta: number) {
  zoom.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((zoom.value + delta) * 100) / 100))
}

function zoomReset() {
  zoom.value = 1
}

const zoomStyle = computed(() => ({
  transform: `scale(${zoom.value})`,
  transformOrigin: 'top left',
}))

// ── Kéo handle: ngang → snap cột (span), dọc → snap bước 20px ───────────────
const GRID_GAP = 12
const dragPreview = ref<{ span: number; height: number } | null>(null)

const tileStyle = computed(() => {
  const span = dragPreview.value?.span ?? props.span
  return {
    gridColumn: `span ${span} / span ${span}`,
    height: `${dragPreview.value?.height ?? props.height}px`,
  }
})

let stopDrag: (() => void) | null = null
const handleRef = ref<HTMLElement | null>(null)

function onResizeStart(down: PointerEvent) {
  const handle = handleRef.value
  const tile = tileRef.value
  if (!handle || !tile || stopDrag) return
  const grid = tile.closest('.statistics-charts') as HTMLElement | null
  const colWidth = gridColumnWidth(grid)
  const start = {
    x: down.clientX,
    y: down.clientY,
    span: props.span,
    height: props.height,
    width: colWidth * props.span + GRID_GAP * (props.span - 1),
  }
  try {
    handle.setPointerCapture?.(down.pointerId)
  } catch {
    // PointerId tổng hợp có thể bị từ chối — window listener là nguồn sự thật.
  }

  const onMove = (move: PointerEvent) => {
    const desiredWidth = start.width + (move.clientX - start.x)
    const span = Math.max(
      TILE_MIN_SPAN,
      Math.min(TILE_MAX_SPAN, Math.round((desiredWidth + GRID_GAP) / (colWidth + GRID_GAP))),
    )
    dragPreview.value = {
      span,
      height: snapChartHeight(start.height + (move.clientY - start.y)),
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
  return Math.max(80, (grid.clientWidth - 3 * GRID_GAP) / 4)
}

onMounted(() => {
  groupVisible.value = false
})

onBeforeUnmount(() => {
  stopDrag?.()
})
</script>

<template>
  <div
    ref="tileRef"
    class="chart-tile"
    :style="tileStyle"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
  >
    <div class="chart-tile-actions" :style="groupStyle" @pointerleave.stop>
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
      <span class="chart-tile-action-sep" aria-hidden="true" />
      <button
        type="button"
        class="icon-btn"
        :title="t('statistics.zoomIn')"
        :aria-label="t('statistics.zoomIn')"
        @click.stop="zoomBy(0.25)"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <circle cx="7" cy="7" r="4.4" fill="none" stroke="currentColor" stroke-width="1.4" />
          <path stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M10.4 10.4L14 14M7 5.2v3.6M5.2 7h3.6" />
        </svg>
      </button>
      <button
        type="button"
        class="icon-btn"
        :title="t('statistics.zoomOut')"
        :aria-label="t('statistics.zoomOut')"
        @click.stop="zoomBy(-0.25)"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <circle cx="7" cy="7" r="4.4" fill="none" stroke="currentColor" stroke-width="1.4" />
          <path stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M10.4 10.4L14 14M5.2 7h3.6" />
        </svg>
      </button>
      <button
        type="button"
        class="icon-btn"
        :title="t('statistics.zoomReset')"
        :aria-label="t('statistics.zoomReset')"
        @click.stop="zoomReset"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M3 8a5 5 0 1 0 1.5-3.6M3 2.8V5h2.2" />
        </svg>
      </button>
    </div>
    <div class="chart-tile-content">
      <div class="chart-tile-zoom" :style="zoomStyle">
        <slot />
      </div>
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
/* MỘT action group duy nhất — đi theo con trỏ trong tile, ẩn khi rời chart. */
.chart-tile-actions {
  position: absolute;
  z-index: 3;
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-2);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
  opacity: 0;
  transition: opacity 0.12s ease;
  pointer-events: auto;
}
.chart-tile-action-sep {
  width: 1px;
  align-self: stretch;
  margin: 3px 1px;
  background: var(--border);
}
.chart-tile-content {
  height: 100%;
  min-height: 0;
  overflow: auto;
}
.chart-tile-zoom {
  min-width: 100%;
  height: 100%;
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
