<script setup>
import { computed } from 'vue'

const props = defineProps({
  rules: { type: Array, default: () => [] },
  categories: { type: Array, default: () => [] },
  steps: { type: Array, default: () => [] },
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
            <div v-else class="rules-item-steps muted">— không dùng bởi step nào</div>
          </div>
        </div>
      </template>
    </template>
    </div>
  </aside>
</template>
