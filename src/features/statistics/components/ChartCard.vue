<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { parseMarkdown, renderMermaid } from '../../../core/lib/markdownLib'
import { attachMermaidControls } from '../../../core/composables/useMermaidControls'
import { buildChart, type ChartKind, type ChartStyleConfig } from '../lib/mermaidChart'

/**
 * Wrapper chart thuần render (issue #231 quyết định 1): nhận DATA + config,
 * nội bộ build mermaid rồi đi qua pipeline markdownLib. Đổi renderer sau này
 * (chart.js/echarts) chỉ sửa file này — consumers và test không đổi.
 *
 * Chart vẽ FULL panel: width đo qua ResizeObserver, height theo styleConfig.
 * Không chứa nút bấm — ChartTile (cha) sở hữu overlay button group + resize.
 */
const props = withDefaults(
  defineProps<{
    /** Tiêu đề VẼ TRONG chart (mermaid title); rỗng → không vẽ. */
    title?: string
    chartType: ChartKind
    labels: string[]
    values: number[]
    loading?: boolean
    styleConfig?: ChartStyleConfig
    /** Scale đơn vị K/M/B — giá trị chia divisor. */
    unitScale?: { divisor: number; axisSuffix: string }
  }>(),
  { title: '', loading: false, styleConfig: undefined, unitScale: undefined },
)

const { t } = useI18nHelpers()
const bodyRef = ref<HTMLElement | null>(null)
/** Width vùng vẽ đo được (px) — fallback 720 khi chưa đo được (jsdom). */
const renderWidth = ref(720)

const hasData = computed(
  () => props.labels.length > 0 && props.values.some((v) => Number.isFinite(v) && v > 0),
)

const definition = computed(() => {
  if (!hasData.value) return ''
  return buildChart(props.chartType, {
    title: props.title,
    labels: props.labels,
    values: props.values,
    width: renderWidth.value,
    style: props.styleConfig,
    unitScale: props.unitScale,
  })
})

const html = computed(() =>
  definition.value ? parseMarkdown(`\`\`\`mermaid\n${definition.value}\n\`\`\`\n`) : '',
)

const bodyStyle = computed(() => ({
  height: `${props.styleConfig?.height ?? 300}px`,
}))

async function scheduleRender(): Promise<void> {
  await nextTick()
  if (bodyRef.value && definition.value) {
    await renderMermaid(bodyRef.value)
    attachMermaidControls(bodyRef.value, { onToggleFullscreen: onToggleMermaidFullscreen })
  }
}

function onToggleMermaidFullscreen(wrapEl: HTMLElement) {
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => {})
  } else if (wrapEl.requestFullscreen) {
    void wrapEl.requestFullscreen().catch(() => {})
  }
}

let widthObserver: ResizeObserver | null = null
let themeObserver: MutationObserver | null = null

onMounted(() => {
  if (bodyRef.value) renderWidth.value = bodyRef.value.clientWidth || 720
  // jsdom không có ResizeObserver — guard để test unit không cần polyfill.
  if (typeof ResizeObserver !== 'undefined' && bodyRef.value) {
    widthObserver = new ResizeObserver((records) => {
      const w = records[0]?.contentRect.width
      if (w && Math.round(w) !== renderWidth.value) renderWidth.value = Math.round(w)
    })
    widthObserver.observe(bodyRef.value)
  }
  // Theme shell đổi `data-theme` trên <html> — mermaid cần vẽ lại theo theme mới.
  themeObserver = new MutationObserver(() => {
    void scheduleRender()
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  void scheduleRender()
})

onBeforeUnmount(() => {
  widthObserver?.disconnect()
  themeObserver?.disconnect()
})

watch([definition, () => props.loading], () => {
  void scheduleRender()
})
</script>

<template>
  <div class="chart-card" :class="{ 'is-loading': loading }">
    <div v-if="loading" class="chart-card-state">{{ t('statistics.loading') }}</div>
    <div v-else-if="!hasData" class="chart-card-state">{{ t('statistics.emptyChart') }}</div>
    <!-- v-html từ definition do chính feature build (không phải input người dùng) -->
    <div v-else ref="bodyRef" class="chart-card-body" :style="bodyStyle">
      <div class="chart-canvas">
        <div class="chart-canvas-plot" v-html="html" />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.chart-card {
  border-radius: 8px;
  background: var(--panel);
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.chart-card-state {
  color: var(--text-muted);
  font-size: 0.85rem;
  padding: 2rem 0.5rem;
  text-align: center;
}
/* Panel chart: height theo config, chart full width — tràn thì scroll. */
.chart-card-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 0.25rem 0;
}
.chart-canvas {
  min-width: 100%;
  width: fit-content;
}
.chart-canvas-plot :deep(.mermaid) {
  display: flex;
  justify-content: center;
  min-height: 2rem;
}
/* `.mermaid` là flex (block-level) khiến toolbar zoom/fullscreen (float:right)
   rơi xuống đáy wrap — ép toolbar về góc trên như ArtifactPanel. */
.chart-canvas-plot :deep(.mermaid-toolbar) {
  float: none;
  position: absolute;
  top: 4px;
  right: 4px;
}
</style>
