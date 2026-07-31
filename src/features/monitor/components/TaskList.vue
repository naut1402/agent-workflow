<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import TaskListItem from './TaskListItem.vue'
import { useAppSettings } from '../../../core/composables/useAppSettings'
import { resolveHideMissingArtifacts } from '../../../../shared/schemas/appSettings'

const props = defineProps({
  tasks: { type: Array as () => any[], required: true },
  selectedId: { type: String, default: null },
  openArtifact: { type: Object, default: null }, // { taskId, name }
  projectId: { type: String, default: null },
})
const emit = defineEmits(['select', 'open-artifact', 'task-archived', 'task-deleted', 'create-task'])
const { t } = useI18n()
const { settings, update } = useAppSettings()

// Track which tasks have their file list expanded.
const expanded = ref(new Set())

function toggleExpand(taskId: string) {
  if (expanded.value.has(taskId)) {
    expanded.value.delete(taskId)
  } else {
    expanded.value.add(taskId)
  }
  // Force reactivity on Set mutation.
  expanded.value = new Set(expanded.value)
}

/** Collapse every expanded task's file list — exposed for MonitorLayout's
 * click-outside handling (setting-gated, mục 7). */
function collapseAll() {
  expanded.value = new Set()
}
defineExpose({ collapseAll })

const hideMissing = computed(() => resolveHideMissingArtifacts(settings.value))
function toggleHideMissing() {
  update({ hideMissingArtifacts: !hideMissing.value })
}

// Archived tasks no longer appear in the main list — they're grouped in a
// collapsible section at the bottom instead. Non-archived order is preserved
// (no re-sort) since it's a plain filter over props.tasks.
const activeTasks = computed(() => props.tasks.filter((t) => !t.archived))
const archivedTasks = computed(() => props.tasks.filter((t) => t.archived))
</script>

<template>
  <div class="tasklist-panel">
    <div class="tasklist-head">
      <span class="tasklist-head-label">{{ t('monitor.taskList.title') }}</span>
      <button
        type="button"
        class="icon-btn"
        :title="t('monitor.taskList.createTask')"
        :aria-label="t('monitor.taskList.createTask')"
        @click="emit('create-task')"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 2.5a.75.75 0 0 1 .75.75V7h3.75a.75.75 0 0 1 0 1.5H8.75v3.75a.75.75 0 0 1-1.5 0V8.5H3.5a.75.75 0 0 1 0-1.5h3.75V3.25A.75.75 0 0 1 8 2.5z"
          />
        </svg>
      </button>
    </div>
    <ul class="tasklist tasklist--active">
      <TaskListItem
        v-for="t in activeTasks"
        :key="t.task_id"
        :task="t"
        :selected-id="selectedId"
        :open-artifact="openArtifact"
        :is-expanded="expanded.has(t.task_id)"
        :project-id="projectId"
        :hide-missing="hideMissing"
        @select="emit('select', $event)"
        @toggle-expand="toggleExpand"
        @open-artifact="emit('open-artifact', $event)"
        @task-archived="emit('task-archived')"
        @task-deleted="emit('task-deleted', $event)"
        @toggle-hide-missing="toggleHideMissing"
      />
    </ul>
    <details v-if="archivedTasks.length" class="archived-group">
      <summary>{{ t('monitor.taskList.archivedSummary', { count: archivedTasks.length }) }}</summary>
      <ul class="tasklist tasklist--archived">
        <TaskListItem
          v-for="t in archivedTasks"
          :key="t.task_id"
          :task="t"
          :selected-id="selectedId"
          :open-artifact="openArtifact"
          :is-expanded="expanded.has(t.task_id)"
          :project-id="projectId"
          :hide-missing="hideMissing"
          @select="emit('select', $event)"
          @toggle-expand="toggleExpand"
          @open-artifact="emit('open-artifact', $event)"
          @task-archived="emit('task-archived')"
          @toggle-hide-missing="toggleHideMissing"
        />
      </ul>
    </details>
  </div>
</template>
