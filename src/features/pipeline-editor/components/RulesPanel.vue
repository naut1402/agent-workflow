<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { computed } from 'vue'
const { t } = useI18nHelpers()

const props = defineProps({
  rules: { type: Array as () => any[], default: () => [] },
  categories: { type: Array as () => any[], default: () => [] },
  steps: { type: Array as () => any[], default: () => [] },
  highlightedCategory: { type: String, default: null },
})

const emit = defineEmits(['select-rule'])

function stepUsesCategory(step, category) {
  const rc = step.rule_category
  if (!rc || !category) return false
  if (Array.isArray(rc)) return rc.includes(category)
  return rc === category
}

function stepsForRule(rule) {
  return props.steps.filter((s) => stepUsesCategory(s, rule.category))
}

const groupedRules = computed(() => {
  const groups = { project: {}, global: {} }
  for (const rule of props.rules) {
    const scope = rule.scope === 'global' ? 'global' : 'project'
    if (!groups[scope][rule.category]) groups[scope][rule.category] = []
    groups[scope][rule.category].push(rule)
  }
  return groups
})

function onRuleClick(rule) {
  emit('select-rule', rule)
}
</script>

<template>
  <aside class="rules-panel">
    <div class="rules-panel-head">Rules</div>

    <div class="rules-scroll">
      <div v-if="!rules.length" class="rules-empty">No rules found</div>

      <template v-for="scopeLabel in ['project', 'global']" :key="scopeLabel">
      <template v-if="Object.keys(groupedRules[scopeLabel]).length">
        <div class="rules-scope-label">{{ scopeLabel === 'project' ? 'Project' : 'Global' }}</div>
        <div
          v-for="(scopeRules, category) in groupedRules[scopeLabel]"
          :key="`${scopeLabel}-${category}`"
          class="rules-category-group"
        >
          <div class="rules-category-head">
            <span class="chip chip-category">{{ category }}</span>
          </div>
          <div
            v-for="rule in scopeRules"
            :key="rule.id"
            class="rules-item"
            :class="{
              'rules-item-active': highlightedCategory === rule.category,
            }"
            @click="onRuleClick(rule)"
          >
            <div class="rules-item-name">{{ rule.name }}</div>
            <div class="rules-item-path" :title="rule.path">{{ rule.path }}</div>
            <div v-if="stepsForRule(rule).length" class="rules-item-steps">
              → {{ stepsForRule(rule).map((s) => s.id || s.name).join(', ') }}
            </div>
            <div v-else class="rules-item-steps muted">{{ t('pipelineEditor.rules.noStepUsing') }}</div>
          </div>
        </div>
      </template>
    </template>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.rules-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex: 1;
}

.rules-scroll {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 8px;
}

.rules-panel-head {
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 600;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
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
  cursor: pointer;
  transition: border-color 0.15s;
}
.rules-item:hover { border-color: var(--accent); }
.rules-item-active { border-color: var(--waiting); box-shadow: inset 2px 0 0 var(--waiting); }

.rules-item-name { font-size: 12px; font-weight: 600; }
.rules-item-path {
  font-size: 10px;
  color: var(--muted);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rules-item-steps { font-size: 10px; color: var(--accent); margin-top: 4px; }
.rules-item-steps.muted { color: var(--muted); }
</style>
