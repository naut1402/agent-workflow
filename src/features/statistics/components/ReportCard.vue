<script setup lang="ts">
import { computed } from 'vue'
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { formatNumber, type NumberFormat } from '../lib/format'

/**
 * Thẻ report xếp hạng top-N: các item theo metric được chọn, hướng lớn/nhớn
 * nhất điều khiển bởi config. Vẽ bằng table thuần + bar tỷ lệ — không dùng
 * chart.js. Sống trong ChartTile nên co giãn như chart.
 */
const props = withDefaults(
  defineProps<{
    labels: string[]
    values: number[]
    topN: number
    direction: 'top' | 'bottom'
    numberFormat?: NumberFormat
    /** Nhãn metric cho cột giá trị (vd "Input tokens"). */
    metricLabel?: string
    loading?: boolean
  }>(),
  { numberFormat: 'compact', metricLabel: '', loading: false },
)

const { t } = useI18nHelpers()

interface RankRow {
  rank: number
  label: string
  value: number
  ratio: number // 0..1 so với max trong danh sách
}

const ranking = computed<RankRow[]>(() => {
  const pairs = props.labels
    .map((label, i) => ({ label, value: props.values[i] ?? 0 }))
    .filter((p) => p.label !== '')
  pairs.sort((a, b) => b.value - a.value) // desc
  const sliced = props.direction === 'top' ? pairs.slice(0, props.topN) : pairs.slice(-props.topN).reverse()
  const max = sliced.length ? Math.max(...sliced.map((p) => p.value)) : 0
  return sliced.map((p, i) => ({
    rank: i + 1,
    label: p.label,
    value: p.value,
    ratio: max > 0 ? p.value / max : 0,
  }))
})

const maxValue = computed(() => (ranking.value.length ? ranking.value[0].value : 0))
const avgValue = computed(() => {
  const rows = ranking.value
  if (!rows.length) return 0
  return rows.reduce((s, r) => s + r.value, 0) / rows.length
})
</script>

<template>
  <div class="report-card">
    <div v-if="loading" class="report-card-state">{{ t('statistics.loading') }}</div>
    <div v-else-if="!ranking.length" class="report-card-state">{{ t('statistics.emptyChart') }}</div>
    <div v-else class="report-card-body">
      <table class="report-table">
        <thead>
          <tr>
            <th class="num">#</th>
            <th>{{ t('statistics.table.key') }}</th>
            <th class="num">{{ metricLabel }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in ranking" :key="`${row.rank}-${row.label}`">
            <td class="num report-rank">{{ row.rank }}</td>
            <td class="report-label">
              <span class="report-label-text">{{ row.label }}</span>
              <span
                class="report-bar"
                :class="{ 'is-above': row.value > avgValue, 'is-below': row.value < avgValue }"
                :style="{ width: `${Math.round(row.ratio * 100)}%` }"
              />
            </td>
            <td class="num" :class="row.value > avgValue ? 'is-above' : row.value < avgValue ? 'is-below' : 'is-avg'">
              {{ formatNumber(row.value, numberFormat) }}
            </td>
          </tr>
        </tbody>
      </table>
      <p class="muted report-footer">
        {{ t('statistics.report.footer', {
          n: ranking.length,
          max: formatNumber(maxValue, numberFormat),
          avg: formatNumber(avgValue, numberFormat),
        }) }}
      </p>
    </div>
  </div>
</template>

<style scoped lang="scss">
.report-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.report-card-state {
  color: var(--text-muted);
  font-size: 0.85rem;
  padding: 2rem 0.5rem;
  text-align: center;
}
.report-card-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
}
.report-table {
  width: 100%;
  font-size: 0.8rem;
  border-collapse: collapse;
}
.report-table th,
.report-table td {
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid var(--border);
  text-align: left;
  white-space: nowrap;
}
.report-table th {
  position: sticky;
  top: 0;
  background: var(--panel);
  color: var(--text-muted);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.report-table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.report-rank {
  color: var(--text-muted);
  width: 2rem;
}
.report-label {
  position: relative;
  max-width: 16rem;
}
.report-label-text {
  position: relative;
  z-index: 1;
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
}
.report-bar {
  position: absolute;
  left: 0;
  top: 2px;
  bottom: 2px;
  border-radius: 3px;
  background: var(--accent-dim);
}
.report-bar.is-above {
  background: rgba(255, 140, 105, 0.28);
}
.report-bar.is-below {
  background: rgba(46, 204, 113, 0.22);
}
.is-above {
  color: #ff8c69;
}
.is-below {
  color: #2ecc71;
}
.is-avg {
  color: var(--accent);
}
.report-footer {
  margin: 0.35rem 0 0;
  flex-shrink: 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}
</style>
