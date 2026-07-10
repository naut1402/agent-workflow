<script setup lang="ts">
import { computed, ref } from 'vue'
import { patchTaskArchive } from '../../../api'

const props = defineProps({
  tasks: { type: Array as () => any[], required: true },
  selectedId: { type: String, default: null },
  openArtifact: { type: Object, default: null }, // { taskId, name }
  projectId: { type: String, default: null },
})
const emit = defineEmits(['select', 'open-artifact', 'task-archived'])

// Track which tasks have their file list expanded.
const expanded = ref(new Set())

// Archived tasks are hidden from the default list; tick the checkbox to show them.
const showArchived = ref(false)
const visibleTasks = computed(() =>
  props.tasks.filter((t) => showArchived.value || !t.archived),
)
const archiveError = ref('')

async function toggleArchive(t: any) {
  archiveError.value = ''
  try {
    await patchTaskArchive(
      t.task_id,
      { archived: !t.archived, mtime: t.state_mtime },
      props.projectId ?? undefined,
    )
    emit('task-archived')
  } catch (e: any) {
    if (e?.status === 409) {
      // State changed elsewhere (mtime mismatch) — refresh instead of erroring,
      // same pattern as the HITL 409 handling in PipelineView.vue.
      emit('task-archived')
    } else {
      archiveError.value = String(e.message || e)
    }
  }
}

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
  <label class="archive-filter">
    <input type="checkbox" v-model="showArchived" /> Hiện task đã lưu trữ
  </label>
  <p v-if="archiveError" class="art-warning">{{ archiveError }}</p>
  <ul class="tasklist">
    <li
      v-for="t in visibleTasks"
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
        <button
          v-if="t.current_phase === 'completed' || t.archived"
          class="btn-archive"
          :title="t.archived ? 'Bỏ lưu trữ' : 'Lưu trữ task đã hoàn thành'"
          @click.stop="toggleArchive(t)"
        >{{ t.archived ? '↩' : '🗄' }}</button>
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
