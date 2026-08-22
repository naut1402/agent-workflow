<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import CSelect from '../../../core/ui/CSelect.vue'
import type { CSelectOption } from '../../../core/ui/CSelect.vue'
import { computed } from 'vue'
import {
  CHART_MAX_HEIGHT,
  CHART_MIN_HEIGHT,
  REPORT_TOP_N_MAX,
  REPORT_TOP_N_MIN,
  makeDefaultChartConfig,
  sanitizeChartConfig,
  type ChartKind,
  type ChartConfig,
} from '../lib/chartConfig'
import { USAGE_GROUP_BYS, USAGE_METRICS } from '../schemas/usageStats'

/**
 * Dialog thiết lập MỘT chart instance: gom nhóm / chỉ số / loại biểu đồ /
 * tiêu đề (rỗng → chart không vẽ title) / nhãn trục / màu / kích thước.
 * Sửa trực tiếp vào model (live-apply) — thay đổi áp dụng ngay phía sau dialog.
 */
const props = defineProps<{ allowProjectGroup: boolean }>()

const model = defineModel<ChartConfig>({ required: true })

const emit = defineEmits<{ close: [] }>()

const { t } = useI18nHelpers()

const groupByOptions = computed<CSelectOption[]>(() => {
  const opts: CSelectOption[] = []
  for (const g of USAGE_GROUP_BYS) {
    if (g === 'project' && !props.allowProjectGroup) continue
    opts.push({ value: g, label: t(`statistics.groupBy.${g}`) })
  }
  return opts
})

const metricOptions = computed<CSelectOption[]>(() =>
  USAGE_METRICS.map((m) => ({ value: m, label: t(`statistics.metric.${m}`) })),
)

const chartTypeOptions = computed<CSelectOption[]>(() =>
  (['bar', 'line', 'pie'] as ChartKind[]).map((c) => ({
    value: c,
    label: t(`statistics.chartType.${c}`),
  })),
)

const numberFormatOptions = computed<CSelectOption[]>(() => [
  { value: 'compact', label: t('statistics.numberFormat.compact') },
  { value: 'full', label: t('statistics.numberFormat.full') },
])

const kindOptions = computed<CSelectOption[]>(() => [
  { value: 'chart', label: t('statistics.kind.chart') },
  { value: 'report', label: t('statistics.kind.report') },
])

const directionOptions = computed<CSelectOption[]>(() => [
  { value: 'top', label: t('statistics.report.directionTop') },
  { value: 'bottom', label: t('statistics.report.directionBottom') },
])

function patch(updates: Partial<ChartConfig>) {
  model.value = { ...model.value, ...updates }
}

function patchStyle(updates: Partial<ChartConfig['style']>) {
  model.value = { ...model.value, style: { ...model.value.style, ...updates } }
}

function patchHeight(raw: string) {
  const value = Number(raw)
  if (!Number.isFinite(value)) return
  const clamped = Math.min(CHART_MAX_HEIGHT, Math.max(CHART_MIN_HEIGHT, Math.round(value)))
  patchStyle({ height: clamped })
}

function patchTopN(raw: string) {
  const value = Number(raw)
  if (!Number.isFinite(value)) return
  patch({ topN: Math.min(REPORT_TOP_N_MAX, Math.max(REPORT_TOP_N_MIN, Math.round(value))) })
}

function removePieColor(index: number) {
  patchStyle({ pieColors: (model.value.style.pieColors ?? []).filter((_, i) => i !== index) })
}

function addPieColor() {
  const colors = model.value.style.pieColors ?? []
  if (colors.length >= 12) return
  patchStyle({ pieColors: [...colors, '#4A7DFF'] })
}

function resetDefaults() {
  const fresh = makeDefaultChartConfig({ id: model.value.id })
  model.value = sanitizeChartConfig(fresh) ?? fresh
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal chart-settings-dialog" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>{{ t('statistics.settings.title') }}</h3>
        <button
          type="button"
          class="icon-btn"
          :title="t('statistics.settings.close')"
          :aria-label="t('statistics.settings.close')"
          @click="emit('close')"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              d="M4 4l8 8M12 4l-8 8"
            />
          </svg>
        </button>
      </div>
      <p class="muted chart-settings-hint">{{ t('statistics.settings.hint') }}</p>

      <div class="chart-settings-row">
        <label class="chart-settings-field">
          <span>{{ t('statistics.kind.label') }}</span>
          <CSelect
            :model-value="model.kind"
            :options="kindOptions"
            :aria-label="t('statistics.kind.label')"
            @update:model-value="patch({ kind: $event as ChartConfig['kind'] })"
          />
        </label>
        <label class="chart-settings-field">
          <span>{{ t('statistics.groupBy.label') }}</span>
          <CSelect
            :model-value="model.groupBy"
            :options="groupByOptions"
            :aria-label="t('statistics.groupBy.label')"
            @update:model-value="patch({ groupBy: $event as ChartConfig['groupBy'] })"
          />
        </label>
        <label class="chart-settings-field">
          <span>{{ t('statistics.metric.label') }}</span>
          <CSelect
            :model-value="model.metric"
            :options="metricOptions"
            :aria-label="t('statistics.metric.label')"
            @update:model-value="patch({ metric: $event as ChartConfig['metric'] })"
          />
        </label>
        <template v-if="model.kind === 'chart'">
          <label class="chart-settings-field">
            <span>{{ t('statistics.chartType.label') }}</span>
            <CSelect
              :model-value="model.chartType"
              :options="chartTypeOptions"
              :aria-label="t('statistics.chartType.label')"
              @update:model-value="patch({ chartType: $event as ChartConfig['chartType'] })"
            />
          </label>
        </template>
        <template v-else>
          <label class="chart-settings-field chart-settings-field--num">
            <span>{{ t('statistics.report.topN') }}</span>
            <input
              type="number"
              :min="REPORT_TOP_N_MIN"
              :max="REPORT_TOP_N_MAX"
              :value="model.topN"
              @input="patchTopN(($event.target as HTMLInputElement).value)"
            />
          </label>
          <label class="chart-settings-field">
            <span>{{ t('statistics.report.direction') }}</span>
            <CSelect
              :model-value="model.reportDirection"
              :options="directionOptions"
              :aria-label="t('statistics.report.direction')"
              @update:model-value="patch({ reportDirection: $event as ChartConfig['reportDirection'] })"
            />
          </label>
        </template>
        <label class="chart-settings-field">
          <span>{{ t('statistics.numberFormat.label') }}</span>
          <CSelect
            :model-value="model.numberFormat"
            :options="numberFormatOptions"
            :aria-label="t('statistics.numberFormat.label')"
            @update:model-value="patch({ numberFormat: $event as ChartConfig['numberFormat'] })"
          />
        </label>
      </div>

      <label class="chart-settings-field">
        <span>{{ t('statistics.settings.chartTitle') }}</span>
        <input
          type="text"
          :value="model.title"
          :placeholder="t('statistics.settings.noTitle')"
          @input="patch({ title: ($event.target as HTMLInputElement).value })"
        />
      </label>

      <template v-if="model.kind === 'chart' && model.chartType !== 'pie'">
        <label class="chart-settings-field">
          <span>{{ t('statistics.settings.xAxisTitle') }}</span>
          <input
            type="text"
            :value="model.style.xAxisTitle"
            :placeholder="t('statistics.settings.none')"
            @input="patchStyle({ xAxisTitle: ($event.target as HTMLInputElement).value })"
          />
        </label>
        <label class="chart-settings-field">
          <span>{{ t('statistics.settings.yAxisLabel') }}</span>
          <input
            type="text"
            :value="model.style.yAxisLabel"
            :placeholder="t('statistics.settings.autoLabel')"
            @input="patchStyle({ yAxisLabel: ($event.target as HTMLInputElement).value })"
          />
        </label>
        <label class="chart-settings-field chart-settings-field--color">
          <span>{{ t('statistics.settings.chartColor') }}</span>
          <input
            type="color"
            :value="model.style.color || '#4A7DFF'"
            @input="patchStyle({ color: ($event.target as HTMLInputElement).value })"
          />
        </label>
      </template>

      <div v-else-if="model.kind === 'chart'" class="chart-settings-field">
        <span>{{ t('statistics.settings.pieColors') }}</span>
        <div class="chart-settings-toggles">
          <label class="chart-settings-toggle">
            <input
              type="checkbox"
              :checked="model.style.pieShowLabels ?? true"
              @change="patchStyle({ pieShowLabels: ($event.target as HTMLInputElement).checked })"
            />
            {{ t('statistics.settings.pieShowLabels') }}
          </label>
          <label class="chart-settings-toggle">
            <input
              type="checkbox"
              :checked="model.style.pieShowValues ?? false"
              @change="patchStyle({ pieShowValues: ($event.target as HTMLInputElement).checked })"
            />
            {{ t('statistics.settings.pieShowValues') }}
          </label>
          <label class="chart-settings-toggle">
            <input
              type="checkbox"
              :checked="model.style.pieShowPercent ?? false"
              @change="patchStyle({ pieShowPercent: ($event.target as HTMLInputElement).checked })"
            />
            {{ t('statistics.settings.pieShowPercent') }}
          </label>
        </div>
        <ul class="chart-settings-colors">
          <li v-for="(color, index) in model.style.pieColors ?? []" :key="index">
            <input
              type="color"
              :value="color"
              :aria-label="`${t('statistics.settings.pieColors')} ${index + 1}`"
              @input="
                patchStyle({
                  pieColors: (model.style.pieColors ?? []).map((c, i) =>
                    i === index ? ($event.target as HTMLInputElement).value : c,
                  ),
                })
              "
            />
            <button
              type="button"
              class="icon-btn"
              :title="t('statistics.settings.removeColor')"
              :aria-label="t('statistics.settings.removeColor')"
              @click="removePieColor(index)"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  d="M4 4l8 8M12 4l-8 8"
                />
              </svg>
            </button>
          </li>
        </ul>
        <button type="button" class="chart-settings-add-color" @click="addPieColor">
          {{ t('statistics.settings.addColor') }}
        </button>
      </div>

      <div class="chart-settings-row">
        <label class="chart-settings-field chart-settings-field--num">
          <span>{{ t('statistics.settings.height') }}</span>
          <input
            type="number"
            :min="CHART_MIN_HEIGHT"
            :max="CHART_MAX_HEIGHT"
            :value="model.style.height"
            @input="patchHeight(($event.target as HTMLInputElement).value)"
          />
        </label>
      </div>

      <footer class="chart-settings-actions">
        <button type="button" class="chart-settings-reset" @click="resetDefaults">
          {{ t('statistics.settings.reset') }}
        </button>
        <button type="button" class="chart-settings-close" @click="emit('close')">
          {{ t('statistics.settings.done') }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped lang="scss">
.chart-settings-dialog {
  width: min(560px, 94vw);
  gap: 0.75rem;
}
.chart-settings-hint {
  margin: 0 0 0.25rem;
  font-size: 0.8rem;
  color: var(--text-muted);
}
.chart-settings-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.85rem;
  flex: 1 1 10rem;
}
.chart-settings-field > span {
  color: var(--text-muted);
  font-size: 0.78rem;
}
.chart-settings-field input[type='text'],
.chart-settings-field input[type='number'] {
  padding: 0.35rem 0.55rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--input-surface);
  color: var(--text);
  font-size: 0.85rem;
}
.chart-settings-field--num input {
  width: 100%;
}
.chart-settings-field--color {
  flex-direction: row;
  align-items: center;
  gap: 0.6rem;
  flex: 0 0 auto;
}
.chart-settings-field--color input[type='color'] {
  width: 2.6rem;
  height: 1.8rem;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: none;
  cursor: pointer;
}
.chart-settings-row {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.chart-settings-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1rem;
}
.chart-settings-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.82rem;
  color: var(--text);
  cursor: pointer;
}
.chart-settings-toggle input {
  accent-color: var(--accent);
}
.chart-settings-colors {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.chart-settings-colors li {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
}
.chart-settings-colors input[type='color'] {
  width: 2.2rem;
  height: 1.8rem;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: none;
  cursor: pointer;
}
.chart-settings-add-color {
  align-self: flex-start;
  margin-top: 0.35rem;
  padding: 0.3rem 0.7rem;
  border: 1px dashed var(--border);
  border-radius: 6px;
  background: none;
  color: var(--muted);
  font-size: 0.78rem;
  cursor: pointer;
}
.chart-settings-add-color:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.chart-settings-actions {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.chart-settings-reset {
  padding: 0.4rem 0.9rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: none;
  color: var(--muted);
  font-size: 0.85rem;
  cursor: pointer;
}
.chart-settings-reset:hover {
  color: var(--danger);
  border-color: var(--danger);
}
.chart-settings-close {
  padding: 0.4rem 1rem;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--accent-dim);
  color: var(--accent);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
}
</style>
