<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import TaskListItem from './TaskListItem.vue'

const props = defineProps({
  tasks: { type: Array as () => any[], required: true },
  selectedId: { type: String, default: null },
  openArtifact: { type: Object, default: null }, // { taskId, name }
  projectId: { type: String, default: null },
})
const emit = defineEmits(['select', 'open-artifact', 'task-archived'])
const { t } = useI18n()

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

// Archived tasks no longer appear in the main list — they're grouped in a
// collapsible section at the bottom instead. Non-archived order is preserved
// (no re-sort) since it's a plain filter over props.tasks.
const activeTasks = computed(() => props.tasks.filter((t) => !t.archived))
const archivedTasks = computed(() => props.tasks.filter((t) => t.archived))
</script>

<template>
  <ul class="tasklist">
    <TaskListItem
      v-for="t in activeTasks"
      :key="t.task_id"
      :task="t"
      :selected-id="selectedId"
      :open-artifact="openArtifact"
      :is-expanded="expanded.has(t.task_id)"
      :project-id="projectId"
      @select="emit('select', $event)"
      @toggle-expand="toggleExpand"
      @open-artifact="emit('open-artifact', $event)"
      @task-archived="emit('task-archived')"
    />
  </ul>
  <details v-if="archivedTasks.length" class="archived-group">
    <summary>{{ t('monitor.taskList.archivedSummary', { count: archivedTasks.length }) }}</summary>
    <ul class="tasklist">
      <TaskListItem
        v-for="t in archivedTasks"
        :key="t.task_id"
        :task="t"
        :selected-id="selectedId"
        :open-artifact="openArtifact"
        :is-expanded="expanded.has(t.task_id)"
        :project-id="projectId"
        @select="emit('select', $event)"
        @toggle-expand="toggleExpand"
        @open-artifact="emit('open-artifact', $event)"
        @task-archived="emit('task-archived')"
      />
    </ul>
  </details>
</template>
