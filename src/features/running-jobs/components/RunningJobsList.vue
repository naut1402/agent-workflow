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
