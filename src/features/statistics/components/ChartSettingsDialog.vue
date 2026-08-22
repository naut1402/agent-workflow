<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import type { ChartKind, ChartStyleConfig } from '../lib/mermaidChart'
import {
  CHART_MAX_HEIGHT,
  CHART_MAX_WIDTH,
  CHART_MIN_HEIGHT,
  CHART_MIN_WIDTH,
  DEFAULT_CHART_STYLE,
} from '../lib/mermaidChart'

/**
 * Dialog thuộc tính chart — chỉ expose những gì mermaid hiện tại render được
 * (kích thước, tiêu đề/nhãn trục, màu). Sửa trực tiếp vào model (live-apply):
 * thay đổi áp dụng ngay vào chart phía sau, không cần nút Lưu.
 */
defineProps<{ chartType: ChartKind }>()

const model = defineModel<ChartStyleConfig>({ required: true })

const emit = defineEmits<{ close: [] }>()

const { t } = useI18nHelpers()

function patch(updates: Partial<ChartStyleConfig>) {
  model.value = { ...model.value, ...updates }
}

function patchSize(field: 'width' | 'height', raw: string) {
  const value = Number(raw)
  if (!Number.isFinite(value)) return
  const clamped =
    field === 'width'
      ? Math.min(CHART_MAX_WIDTH, Math.max(CHART_MIN_WIDTH, Math.round(value)))
      : Math.min(CHART_MAX_HEIGHT, Math.max(CHART_MIN_HEIGHT, Math.round(value)))
  patch({ [field]: clamped } as Partial<ChartStyleConfig>)
}

function removePieColor(index: number) {
  patch({ pieColors: (model.value.pieColors ?? []).filter((_, i) => i !== index) })
}

function addPieColor() {
  const colors = model.value.pieColors ?? []
  if (colors.length >= 12) return
  patch({ pieColors: [...colors, '#4A7DFF'] })
}

function resetDefaults() {
  model.value = { ...DEFAULT_CHART_STYLE }
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

      <label class="chart-settings-field">
        <span>{{ t('statistics.settings.chartTitle') }}</span>
        <input
          type="text"
          :value="model.titleOverride"
          :placeholder="t('statistics.settings.autoTitle')"
          @input="patch({ titleOverride: ($event.target as HTMLInputElement).value })"
        />
      </label>

      <template v-if="chartType !== 'pie'">
        <label class="chart-settings-field">
          <span>{{ t('statistics.settings.xAxisTitle') }}</span>
          <input
            type="text"
            :value="model.xAxisTitle"
            :placeholder="t('statistics.settings.none')"
            @input="patch({ xAxisTitle: ($event.target as HTMLInputElement).value })"
          />
        </label>
        <label class="chart-settings-field">
          <span>{{ t('statistics.settings.yAxisLabel') }}</span>
          <input
            type="text"
            :value="model.yAxisLabel"
            :placeholder="t('statistics.settings.autoLabel')"
            @input="patch({ yAxisLabel: ($event.target as HTMLInputElement).value })"
          />
        </label>
        <label class="chart-settings-field chart-settings-field--color">
          <span>{{ t('statistics.settings.chartColor') }}</span>
          <input
            type="color"
            :value="model.color || DEFAULT_CHART_STYLE.color"
            @input="patch({ color: ($event.target as HTMLInputElement).value })"
          />
        </label>
      </template>

      <div v-else class="chart-settings-field">
        <span>{{ t('statistics.settings.pieColors') }}</span>
        <ul class="chart-settings-colors">
          <li v-for="(color, index) in model.pieColors ?? []" :key="index">
            <input
              type="color"
              :value="color"
              :aria-label="`${t('statistics.settings.pieColors')} ${index + 1}`"
              @input="
                patch({
                  pieColors: (model.pieColors ?? []).map((c, i) =>
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
          <span>{{ t('statistics.settings.width') }}</span>
          <input
            type="number"
            :min="CHART_MIN_WIDTH"
            :max="CHART_MAX_WIDTH"
            :value="model.width"
            @input="patchSize('width', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="chart-settings-field chart-settings-field--num">
          <span>{{ t('statistics.settings.height') }}</span>
          <input
            type="number"
            :min="CHART_MIN_HEIGHT"
            :max="CHART_MAX_HEIGHT"
            :value="model.height"
            @input="patchSize('height', ($event.target as HTMLInputElement).value)"
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
  width: min(520px, 94vw);
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
