<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { parseMarkdown, renderMermaid } from '../../../core/lib/markdownLib'
import { attachMermaidControls } from '../../../core/composables/useMermaidControls'
import {
  buildChart,
  clampChartSize,
  type ChartKind,
  type ChartStyleConfig,
} from '../lib/mermaidChart'

/**
 * Wrapper chart cho statistics (issue #231 quyết định 1): nhận DATA + config
 * (không nhận mermaid definition sẵn) nên đổi renderer sau này (chart.js/echarts)
 * chỉ sửa bên trong file này — consumers và test không đổi. Slot `control` cho
 * panel gắn range/metric/chart-type selector mà không cần biết renderer.
 *
 * Body có chiều cao cố định + scroll; handle ở GÓC CHART (không phải panel) kéo
 * đổi kích thước chart (width/height áp qua directive config của mermaid).
 */
const props = withDefaults(
  defineProps<{
    title: string
    chartType: ChartKind
    labels: string[]
    values: number[]
    valueLabel?: string
    loading?: boolean
    styleConfig?: ChartStyleConfig
  }>(),
  { valueLabel: '', loading: false, styleConfig: undefined },
)

const emit = defineEmits<{ resize: [width: number, height: number] }>()

const { t } = useI18nHelpers()
const chartRoot = ref<HTMLElement | null>(null)
const resizeHandle = ref<HTMLElement | null>(null)
/** Kích thước preview trong lúc kéo (chỉ đổi CSS, không re-render mermaid). */
const dragPreview = ref<{ width: number; height: number } | null>(null)

const hasData = computed(
  () => props.labels.length > 0 && props.values.some((v) => Number.isFinite(v) && v > 0),
)

const definition = computed(() => {
  if (!hasData.value) return ''
  return buildChart(props.chartType, {
    title: props.title,
    labels: props.labels,
    values: props.values,
    valueLabel: props.valueLabel || props.title,
    style: props.styleConfig,
  })
})

const html = computed(() =>
  definition.value ? parseMarkdown(`\`\`\`mermaid\n${definition.value}\n\`\`\`\n`) : '',
)

const canvasStyle = computed(() => {
  const size = dragPreview.value
  if (!size) return undefined
  return { width: `${size.width}px`, height: `${size.height}px` }
})

async function scheduleRender(): Promise<void> {
  await nextTick()
  const root = chartRoot.value
  if (!root || !definition.value) return
  await renderMermaid(root)
  attachMermaidControls(root, { onToggleFullscreen: onToggleMermaidFullscreen })
}

function onToggleMermaidFullscreen(wrapEl: HTMLElement) {
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => {})
  } else if (wrapEl.requestFullscreen) {
    void wrapEl.requestFullscreen().catch(() => {})
  }
}

// Kéo handle góc chart: preview bằng CSS trong lúc kéo, commit size khi thả
// (một lần re-render mermaid duy nhất thay vì vẽ lại mỗi pointermove).
// Listener move/up gắn trên window — pointer capture với pointerId tổng hợp
// không đảm bảo hoạt động, và pointerup có thể nổ trên phần tử khác.
let stopDrag: (() => void) | null = null

function onResizeStart(down: PointerEvent) {
  const handle = resizeHandle.value
  if (!handle || stopDrag) return
  const base = props.styleConfig
    ? clampChartSize(props.styleConfig.width, props.styleConfig.height)
    : { width: 720, height: 300 }
  const startX = down.clientX
  const startY = down.clientY
  try {
    handle.setPointerCapture?.(down.pointerId)
  } catch {
    // PointerId tổng hợp có thể bị từ chối — window listener là nguồn sự thật.
  }

  const onMove = (move: PointerEvent) => {
    dragPreview.value = clampChartSize(
      base.width + (move.clientX - startX),
      base.height + (move.clientY - startY),
    )
  }
  const onUp = () => {
    stopDrag?.()
    const final = dragPreview.value
    dragPreview.value = null
    if (final && (final.width !== base.width || final.height !== base.height)) {
      emit('resize', final.width, final.height)
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

// Theme shell đổi `data-theme` trên <html> — mermaid cần vẽ lại theo theme mới
// (renderMermaid tự re-render khi data-mermaid-theme lệch theme hiện tại).
let themeObserver: MutationObserver | null = null

onMounted(() => {
  void scheduleRender()
  themeObserver = new MutationObserver(() => {
    void scheduleRender()
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
})

onBeforeUnmount(() => {
  themeObserver?.disconnect()
  themeObserver = null
  stopDrag?.()
})

watch([definition, () => props.loading], () => {
  void scheduleRender()
})
</script>

<template>
  <section class="chart-card" :class="{ 'is-loading': loading }">
    <header class="chart-card-head">
      <h3 class="chart-card-title">{{ title }}</h3>
      <div class="chart-card-controls">
        <slot name="control" />
      </div>
    </header>
    <div v-if="loading" class="chart-card-state">{{ t('statistics.loading') }}</div>
    <div v-else-if="!hasData" class="chart-card-state">{{ t('statistics.emptyChart') }}</div>
    <!-- v-html từ definition do chính feature build (không phải input người dùng) -->
    <div v-else class="chart-card-body">
      <div ref="chartRoot" class="chart-canvas" :style="canvasStyle">
        <div class="chart-canvas-plot" v-html="html" />
        <span
          ref="resizeHandle"
          class="chart-resize-handle"
          role="separator"
          :title="t('statistics.settings.resizeHint')"
          @pointerdown="onResizeStart"
        />
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.chart-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  padding: 0.75rem 1rem;
  margin: 0.5rem 0 0.75rem;
}
.chart-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.chart-card-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 500;
}
.chart-card-controls {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}
.chart-card-state {
  color: var(--text-muted);
  font-size: 0.85rem;
  padding: 2.5rem 0;
  text-align: center;
}
/* Panel cố định chiều cao — chart to hơn thì scroll, không đẩy bảng xuống. */
.chart-card-body {
  height: 380px;
  overflow: auto;
  padding: 0.5rem 0 0.25rem;
}
.chart-canvas {
  position: relative;
  min-width: 100%;
  width: fit-content;
}
.chart-canvas-plot :deep(.mermaid) {
  display: flex;
  justify-content: center;
  min-height: 2rem;
}
/* `.mermaid` là flex (block-level) khiến toolbar zoom/fullscreen (float:right)
   rơi xuống đáy wrap và đè handle resize — ép toolbar về góc trên như ArtifactPanel. */
.chart-canvas-plot :deep(.mermaid-toolbar) {
  float: none;
  position: absolute;
  top: 4px;
  right: 4px;
}
/* Handle góc dưới-phải của CHART — kéo đổi width/height chart (không phải panel). */
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
