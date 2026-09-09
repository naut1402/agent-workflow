<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import type { TaskGroup } from '../lib/groupRunningJobs'

defineProps<{ groups: TaskGroup[]; truncated: boolean; hiddenTaskCount: number }>()
const emit = defineEmits<{ select: [taskId: string] }>()

const { t } = useI18nHelpers()

function taskLabel(taskId: string | null) {
  return taskId ?? t('runningJobs.list.unknownTask')
}

function stepLabel(stepId: string | null) {
  return stepId ?? t('runningJobs.list.unknownStep')
}
</script>

<template>
  <div class="running-jobs-list">
    <header class="running-jobs-list-header">
      <span>{{ t('runningJobs.list.title') }}</span>
    </header>
    <p v-if="!groups.length" class="running-jobs-list-empty">{{ t('runningJobs.list.empty') }}</p>
    <ul v-else class="running-jobs-list-items">
      <li
        v-for="(group, idx) in groups"
        :key="group.taskId ?? `unknown-${idx}`"
        class="running-jobs-list-task"
        :class="{ clickable: Boolean(group.taskId) }"
      >
        <button
          v-if="group.taskId"
          type="button"
          class="running-jobs-list-task-row"
          @click="emit('select', group.taskId)"
        >
          <span class="running-jobs-list-task-label">{{ taskLabel(group.taskId) }}</span>
          <span class="running-jobs-list-task-badge">{{ group.jobCount }}</span>
        </button>
        <div v-else class="running-jobs-list-task-row">
          <span class="running-jobs-list-task-label">{{ taskLabel(group.taskId) }}</span>
          <span class="running-jobs-list-task-badge">{{ group.jobCount }}</span>
        </div>
        <ul class="running-jobs-list-steps">
          <li v-for="(step, sidx) in group.steps" :key="step.stepId ?? `null-${sidx}`" class="running-jobs-list-step">
            <span class="running-jobs-list-step-label">{{ stepLabel(step.stepId) }}</span>
            <span class="running-jobs-list-step-count">{{ t('runningJobs.list.jobCount', { n: step.jobs.length }) }}</span>
          </li>
        </ul>
      </li>
    </ul>
    <footer v-if="truncated" class="running-jobs-list-truncated">
      {{ t('runningJobs.list.truncated', { n: hiddenTaskCount }) }}
    </footer>
  </div>
</template>

<style scoped lang="scss">
.running-jobs-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--text);
}
.running-jobs-list-empty {
  padding: 12px 10px;
  font-size: 12px;
  color: var(--muted);
}
.running-jobs-list-items {
  list-style: none;
  margin: 0;
  padding: 0;
}
.running-jobs-list-task {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text);
  border-bottom: 1px solid var(--border);
}
.running-jobs-list-task:last-child {
  border-bottom: none;
}
.running-jobs-list-task.clickable {
  cursor: pointer;
}
.running-jobs-list-task.clickable:hover {
  background: var(--hover-surface);
}
.running-jobs-list-task-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
}
.running-jobs-list-task.clickable .running-jobs-list-task-row {
  cursor: pointer;
}
.running-jobs-list-task-label {
  flex: 1;
  min-width: 0;
  overflow-wrap: break-word;
  font-weight: 600;
}
.running-jobs-list-task-badge {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--accent-dim);
  color: var(--accent);
  font-size: 10px;
  line-height: 16px;
  text-align: center;
  flex-shrink: 0;
}
.running-jobs-list-steps {
  list-style: none;
  margin: 6px 0 0;
  padding: 0 0 0 8px;
}
.running-jobs-list-step {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
  color: var(--muted);
  font-size: 11px;
}
.running-jobs-list-step-label {
  flex: 1;
  min-width: 0;
  overflow-wrap: break-word;
}
.running-jobs-list-step-count {
  flex-shrink: 0;
}
.running-jobs-list-truncated {
  padding: 8px 10px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--muted);
}
</style>
