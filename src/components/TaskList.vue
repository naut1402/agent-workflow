<script setup>
import { ref } from 'vue'

const props = defineProps({
  tasks: { type: Array, required: true },
  selectedId: { type: String, default: null },
  openArtifact: { type: Object, default: null }, // { taskId, name }
})
const emit = defineEmits(['select', 'open-artifact'])

// Track which tasks have their file list expanded.
const expanded = ref(new Set())

function toggleExpand(taskId) {
  if (expanded.value.has(taskId)) {
    expanded.value.delete(taskId)
  } else {
    expanded.value.add(taskId)
  }
  // Force reactivity on Set mutation.
  expanded.value = new Set(expanded.value)
}

function selectTask(taskId) {
  emit('select', taskId)
  if (!expanded.value.has(taskId)) toggleExpand(taskId)
}

function phaseLabel(t) {
  if (t.has_qa) return 'chờ Q&A'
  if (t.hitl_pending) return t.hitl_pending
  if (t.current_phase) return t.current_phase
  return '—'
}

// Stable order matching ArtifactPanel's ORDER list.
const ORDER = [
  'investigate.md', 'investigate-po.md',
  'design.md', 'design-po.md',
  'phpstan.md', 'review.md', 'test-spec.md', 'pr-desc.md',
  'qa.md',
]

function sortedArtifacts(task) {
  const a = task.artifacts || {}
  const names = Object.keys(a)
  names.sort((x, y) => {
    const ix = ORDER.indexOf(x)
    const iy = ORDER.indexOf(y)
    return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy) || x.localeCompare(y)
  })
  return names.map((name) => ({ name, ...a[name] }))
}
</script>

<template>
  <ul class="tasklist">
    <li
      v-for="t in tasks"
      :key="t.task_id"
      class="task-entry"
      :class="{ active: t.task_id === selectedId, attention: t.has_qa }"
    >
      <!-- Task header row -->
      <div class="task-row" @click="selectTask(t.task_id)">
        <span
          class="expand-chevron"
          :class="{ open: expanded.has(t.task_id) }"
          @click.stop="toggleExpand(t.task_id)"
        >›</span>
        <span class="id">{{ t.task_id }}</span>
        <span class="phase">{{ phaseLabel(t) }}</span>
        <span v-if="t.has_qa" class="flag qa" title="có câu hỏi blocking">Q</span>
        <span v-else-if="t.hitl_pending" class="flag hitl" title="đang chờ duyệt">⏸</span>
      </div>

      <!-- Collapsible file list -->
      <ul v-if="expanded.has(t.task_id)" class="file-list">
        <li
          v-for="it in sortedArtifacts(t)"
          :key="it.name"
          class="file-item"
          :class="{
            missing: !it.exists,
            active: openArtifact && openArtifact.taskId === t.task_id && openArtifact.name === it.name,
          }"
          @click="it.exists && emit('open-artifact', { taskId: t.task_id, name: it.name })"
        >
          <span class="file-dot">{{ it.exists ? '●' : '○' }}</span>
          <span class="file-name">{{ it.name }}</span>
        </li>
      </ul>
    </li>
  </ul>
</template>
