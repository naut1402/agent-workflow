<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { computed } from 'vue'
import CollapsibleSection from './CollapsibleSection.vue'
const { t } = useI18nHelpers()

const props = defineProps({
  rules: { type: Array as () => any[], default: () => [] },
  /** Khoá section đang mở, do PipelineEditor giữ (dùng chung với CatalogPanel). */
  openSections: { type: Object as () => Set<string>, default: () => new Set(['rules']) },
})

const emit = defineEmits(['toggle-section'])

const groupedRules = computed(() => {
  const groups = { project: {}, global: {} }
  for (const rule of props.rules) {
    const scope = rule.scope === 'global' ? 'global' : 'project'
    if (!groups[scope][rule.category]) groups[scope][rule.category] = []
    groups[scope][rule.category].push(rule)
  }
  return groups
})
</script>

<template>
  <aside class="rules-panel" :class="{ 'rules-panel--open': openSections.has('rules') }">
    <CollapsibleSection
      :title="t('pipelineEditor.sections.rules')"
      :count="rules.length"
      :open="openSections.has('rules')"
      @toggle="emit('toggle-section', 'rules')"
    >
      <div class="rules-scroll">
        <div v-if="!rules.length" class="rules-empty">{{ t('pipelineEditor.rules.empty') }}</div>

        <template v-for="scopeLabel in ['project', 'global']" :key="scopeLabel">
          <template v-if="Object.keys(groupedRules[scopeLabel]).length">
            <div class="rules-scope-label">
              {{ scopeLabel === 'project'
                ? t('pipelineEditor.rules.scopeProject')
                : t('pipelineEditor.rules.scopeGlobal') }}
            </div>
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
