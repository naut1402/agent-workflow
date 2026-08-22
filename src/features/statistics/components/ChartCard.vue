<script setup lang="ts">
import Chart from 'chart.js/auto'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { formatNumber, type NumberFormat } from '../lib/format'
import type { ChartKind, ChartStyleConfig } from '../lib/chartConfig'

/**
 * Wrapper chart cho statistics (issue #231 quyết định 1): nhận DATA + config,
 * nội bộ render bằng chart.js. Trước đây dùng mermaid — đổi renderer chỉ sửa
 * file này, consumers và test không đổi.
 *
 * Chart vẽ full panel (responsive theo container, height = style.height).
 * Không chứa nút bấm — ChartTile (cha) sở hữu action group theo con trỏ.
 */
const props = withDefaults(
  defineProps<{
    /** Tiêu đề VẼ TRONG chart; rỗng → không vẽ. */
    title?: string
    chartType: ChartKind
    labels: string[]
    values: number[]
    loading?: boolean
    numberFormat?: NumberFormat
    styleConfig?: ChartStyleConfig
  }>(),
  { title: '', loading: false, numberFormat: 'compact', styleConfig: undefined },
)

const { t } = useI18nHelpers()
const canvasRef = ref<HTMLCanvasElement | null>(null)
let chart: Chart | null = null

const hasData = computed(
  () => props.labels.length > 0 && props.values.some((v) => Number.isFinite(v) && v > 0),
)

/** Màu chữ/line theo theme shell — đọc CSS var, cập nhật khi data-theme đổi. */
function themeColors() {
  const styles = getComputedStyle(document.documentElement)
  return {
    text: styles.getPropertyValue('--text').trim() || '#c9d1d9',
    muted: styles.getPropertyValue('--text-muted').trim() || '#8b97a3',
    border: styles.getPropertyValue('--border').trim() || '#30363d',
    panel: styles.getPropertyValue('--panel').trim() || '#1a2027',
  }
}

function tickFormat(value: number | string): string {
  return formatNumber(Number(value), props.numberFormat)
}

function buildOptions() {
  const colors = themeColors()
  const isPie = props.chartType === 'pie'
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    plugins: {
      legend: {
        display: isPie,
        position: 'right' as const,
        labels: { color: colors.muted, boxWidth: 12, font: { size: 11 } },
      },
      title: {
        display: !!props.title,
        text: props.title,
        color: colors.text,
        font: { size: 13 },
      },
      tooltip: {
        callbacks: {
          label: (ctx: { label?: string; parsed: number | { [key: string]: number } }) => {
            const raw = typeof ctx.parsed === 'number' ? ctx.parsed : ctx.parsed.y ?? 0
            return ` ${tickFormat(raw)}`
          },
        },
      },
    },
    scales: isPie
      ? {}
      : {
          x: {
            title: {
              display: !!props.styleConfig?.xAxisTitle,
              text: props.styleConfig?.xAxisTitle ?? '',
              color: colors.muted,
              font: { size: 11 },
            },
            ticks: {
              color: colors.muted,
              autoSkip: true,
              maxRotation: 45,
              minRotation: 0,
              font: { size: 10 },
            },
            grid: { color: colors.border },
          },
          y: {
            beginAtZero: true,
            title: {
              display: !!props.styleConfig?.yAxisLabel,
              text: props.styleConfig?.yAxisLabel ?? '',
              color: colors.muted,
              font: { size: 11 },
            },
            ticks: {
              color: colors.muted,
              callback: (value: string | number) => tickFormat(value),
              font: { size: 10 },
            },
            grid: { color: colors.border },
          },
        },
  }
}

function buildChartConfig() {
  const isPie = props.chartType === 'pie'
  const color = props.styleConfig?.color || '#4A7DFF'
  const palette = props.styleConfig?.pieColors || []
  return {
    type: props.chartType as 'bar' | 'line' | 'pie',
    data: {
      labels: [...props.labels],
      datasets: [
        isPie
          ? {
              data: [...props.values],
              backgroundColor: palette.length ? palette : undefined,
              borderColor: themeColors().panel,
              borderWidth: 1,
            }
          : props.chartType === 'line'
            ? {
                data: [...props.values],
                borderColor: color,
                backgroundColor: `${color}33`,
                fill: true,
                tension: 0.25,
                pointRadius: 2,
              }
            : {
                data: [...props.values],
                backgroundColor: color,
                borderRadius: 3,
                maxBarThickness: 48,
              },
      ],
    },
    options: buildOptions(),
  }
}

function ensureChart() {
  if (!canvasRef.value || !hasData.value) return
  destroyChart()
  chart = new Chart(canvasRef.value, buildChartConfig())
}

function destroyChart() {
  chart?.destroy()
  chart = null
}

let themeObserver: MutationObserver | null = null

onMounted(() => {
  ensureChart()
  // Theme shell đổi `data-theme` trên <html> — vẽ lại theo màu mới.
  themeObserver = new MutationObserver(() => {
    if (chart) {
      chart.options = buildOptions()
      chart.update()
    }
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
})

onBeforeUnmount(() => {
  themeObserver?.disconnect()
  destroyChart()
})

watch(
  () => [props.labels, props.values, props.chartType, props.title, props.numberFormat, props.styleConfig, props.loading] as const,
  () => {
    if (!props.loading) ensureChart()
  },
  { deep: true },
)
</script>

<template>
  <div class="chart-card" :class="{ 'is-loading': loading }">
    <div v-if="loading" class="chart-card-state">{{ t('statistics.loading') }}</div>
    <div v-else-if="!hasData" class="chart-card-state">{{ t('statistics.emptyChart') }}</div>
    <div v-else class="chart-card-body" :style="{ height: `${styleConfig?.height ?? 300}px` }">
      <canvas ref="canvasRef" role="img" />
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
.chart-card-body {
  position: relative;
  width: 100%;
  min-height: 0;
}
</style>
