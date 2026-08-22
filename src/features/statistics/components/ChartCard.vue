<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { parseMarkdown, renderMermaid } from '../../../core/lib/markdownLib'
import { attachMermaidControls } from '../../../core/composables/useMermaidControls'
import { buildChart, type ChartKind } from '../lib/mermaidChart'

/**
 * Wrapper chart cho statistics (issue #231 quyết định 1): nhận DATA + config
 * (không nhận mermaid definition sẵn) nên đổi renderer sau này (chart.js/echarts)
 * chỉ sửa bên trong file này — consumers và test không đổi. Slot `control` cho
 * panel gắn range/metric/chart-type selector mà không cần biết renderer.
 */
const props = withDefaults(
  defineProps<{
    title: string
    chartType: ChartKind
    labels: string[]
    values: number[]
    valueLabel?: string
    loading?: boolean
  }>(),
  { valueLabel: '', loading: false },
)

const { t } = useI18nHelpers()
const chartRoot = ref<HTMLElement | null>(null)

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
  })
})

const html = computed(() =>
  definition.value ? parseMarkdown(`\`\`\`mermaid\n${definition.value}\n\`\`\`\n`) : '',
)

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
    <div v-else ref="chartRoot" class="chart-card-body" v-html="html" />
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
.chart-card-body {
  overflow-x: auto;
  padding: 0.5rem 0 0.25rem;
}
/* Node .mermaid do v-html gắn vào — cần :deep để nhận scope attr của parent. */
.chart-card-body :deep(.mermaid) {
  display: flex;
  justify-content: center;
  min-height: 2rem;
}
</style>
