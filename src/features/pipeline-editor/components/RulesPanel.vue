<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { computed, ref, watch } from 'vue'
import CollapsibleSection from './CollapsibleSection.vue'
const { t } = useI18nHelpers()

const props = defineProps({
  rules: { type: Array as () => any[], default: () => [] },
  /** Category thực có rule, đã sắp theo `RULE_CATEGORIES` — từ `GET /api/rules`. */
  categories: { type: Array as () => string[], default: () => [] },
  /** Khoá section đang mở, do PipelineEditor giữ (dùng chung với CatalogPanel). */
  openSections: { type: Object as () => Set<string>, default: () => new Set(['rules']) },
})

const emit = defineEmits(['toggle-section'])

const categoryFilter = ref('all')

const filteredRules = computed(() =>
  categoryFilter.value === 'all'
    ? props.rules
    : props.rules.filter((r) => r.category === categoryFilter.value),
)

const groupedRules = computed(() => {
  const groups = { project: {}, global: {} }
  for (const rule of filteredRules.value) {
    const scope = rule.scope === 'global' ? 'global' : 'project'
    if (!groups[scope][rule.category]) groups[scope][rule.category] = []
    groups[scope][rule.category].push(rule)
  }
  return groups
})

/** Nhãn nhóm theo scope — tra ở script để template không phải mang nhánh rẽ. */
function scopeLabelText(scope: string) {
  return scope === 'project'
    ? t('pipelineEditor.rules.scopeProject')
    : t('pipelineEditor.rules.scopeGlobal')
}

/**
 * Một thông điệp rỗng duy nhất cho cả 2 trạng thái: chưa có rule nào, và có rule
 * nhưng filter không khớp — phân biệt ở đây thay vì bằng `v-if` / `v-else-if`.
 */
const emptyMessage = computed(() => {
  if (!props.rules.length) return t('pipelineEditor.rules.empty')
  if (!filteredRules.value.length) return t('pipelineEditor.rules.emptyFiltered')
  return ''
})

// Đổi project -> tập category đổi -> lựa chọn cũ có thể không còn trong option.
// Rơi về 'all' thay vì để select trắng và danh sách rỗng không lý do.
watch(
  () => props.categories,
  (list) => {
    if (categoryFilter.value !== 'all' && !list.includes(categoryFilter.value)) {
      categoryFilter.value = 'all'
    }
  },
)
</script>

<template>
  <aside class="rules-panel" :class="{ 'rules-panel--open': openSections.has('rules') }">
    <CollapsibleSection
      :title="t('pipelineEditor.sections.rules')"
      :count="filteredRules.length"
      :open="openSections.has('rules')"
      @toggle="emit('toggle-section', 'rules')"
    >
      <!-- Control lọc thuộc về thân mục nó phục vụ; không có category nào thì
           không dựng control chết. `<select>` native vì popup của nó vẽ ở tầng
           OS nên không bị các ancestor `overflow: hidden` cắt (coding-guideline §5). -->
      <div v-if="categories.length" class="rules-toolbar">
        <select
          v-model="categoryFilter"
          class="rules-category-filter"
          :aria-label="t('pipelineEditor.rules.filterCategory')"
          :title="t('pipelineEditor.rules.filterCategory')"
        >
          <option value="all">{{ t('pipelineEditor.rules.categoryAll') }}</option>
          <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
        </select>
      </div>

      <div class="rules-scroll">
        <div v-if="emptyMessage" class="rules-empty">{{ emptyMessage }}</div>

        <template v-for="scopeLabel in ['project', 'global']" :key="scopeLabel">
          <template v-if="Object.keys(groupedRules[scopeLabel]).length">
            <div class="rules-scope-label">{{ scopeLabelText(scopeLabel) }}</div>
            <div
              v-for="(scopeRules, category) in groupedRules[scopeLabel]"
              :key="`${scopeLabel}-${category}`"
              class="rules-category-group"
            >
              <div class="rules-category-head">
                <span class="chip chip-category">{{ category }}</span>
              </div>
              <div v-for="rule in scopeRules" :key="rule.id" class="rules-item">
                <div class="rules-item-name">{{ rule.name }}</div>
                <div class="rules-item-path" :title="rule.path">{{ rule.path }}</div>
              </div>
            </div>
          </template>
        </template>
      </div>
    </CollapsibleSection>
  </aside>
</template>

<style scoped lang="scss">
/* Hợp đồng cuộn (docs/ui-overflow.md): xem `.catalog-panel` — panel chỉ giành
   chiều cao khi section của nó đang mở. Vùng cuộn duy nhất là `.rules-scroll`. */
.rules-panel {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex: 0 0 auto;
}
.rules-panel--open { flex: 1 1 0; }

/* Ngân sách cố định của toolbar trừ thẳng vào `.rules-scroll` — giữ nó ở một
   hàng, padding tối thiểu (docs/ui-overflow.md). */
.rules-toolbar {
  padding: 6px 8px;
  flex-shrink: 0;
}
.rules-category-filter {
  width: 100%;
  background: var(--panel-2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 5px;
  padding: 4px 7px;
  font-size: 11px;
  font-family: inherit;
}

.rules-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 8px;
}

.rules-empty {
  color: var(--muted);
  font-size: 12px;
  padding: 16px;
  text-align: center;
}

.rules-scope-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--muted);
  padding: 10px 10px 4px;
}

.rules-category-group { margin-bottom: 6px; }

.rules-category-head { padding: 0 10px 4px; }

.chip-category {
  font-size: 10px;
  padding: 2px 6px;
  background: rgba(var(--accent-rgb), 0.12);
  border: 1px solid rgba(var(--accent-rgb), 0.3);
  color: var(--accent);
}

.rules-item {
  margin: 0 8px 4px;
  padding: 7px 9px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.rules-item-name { font-size: 12px; font-weight: 600; }
.rules-item-path {
  font-size: 10px;
  color: var(--muted);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
