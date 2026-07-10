<script setup lang="ts">
import { ref } from 'vue'
import { patchTaskArchive } from '../../../api'

const props = defineProps({
  task: { type: Object, required: true },
  selectedId: { type: String, default: null },
  openArtifact: { type: Object, default: null }, // { taskId, name }
  isExpanded: { type: Boolean, default: false },
  projectId: { type: String, default: null },
})
const emit = defineEmits(['select', 'toggle-expand', 'open-artifact', 'task-archived'])

const archiveError = ref('')

async function toggleArchive() {
  archiveError.value = ''
  try {
    await patchTaskArchive(
      props.task.task_id,
      { archived: !props.task.archived, mtime: props.task.state_mtime },
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

function selectTask() {
  emit('select', props.task.task_id)
  if (!props.isExpanded) emit('toggle-expand', props.task.task_id)
}

function phaseLabel(t: any) {
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

function sortedArtifacts(task: any) {
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
  <li
    class="task-entry"
    :class="{ active: task.task_id === selectedId, attention: task.has_qa }"
  >
    <!-- Task header row -->
    <div class="task-row" @click="selectTask">
      <span
        class="expand-chevron"
        :class="{ open: isExpanded }"
        @click.stop="emit('toggle-expand', task.task_id)"
      >›</span>
      <span class="id">{{ task.task_id }}</span>
      <span class="phase">{{ phaseLabel(task) }}</span>
      <span v-if="task.has_qa" class="flag qa" title="có câu hỏi blocking">Q</span>
      <span v-else-if="task.hitl_pending" class="flag hitl" title="đang chờ duyệt">⏸</span>
      <button
        class="btn-archive"
        :title="task.archived ? 'Bỏ lưu trữ' : 'Lưu trữ task'"
        @click.stop="toggleArchive"
      ><template v-if="task.archived">↩</template><svg
          v-else
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.25"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        ><rect x="2" y="2" width="12" height="3" rx="1" /><path d="M3 5v7.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5" /><path d="M6.5 8.5h3" /></svg></button>
    </div>
    <p v-if="archiveError" class="art-warning">{{ archiveError }}</p>

    <!-- Collapsible file list -->
    <ul v-if="isExpanded" class="file-list">
      <li
        v-for="it in sortedArtifacts(task)"
        :key="it.name"
        class="file-item"
        :class="{
          missing: !it.exists,
          active: openArtifact && openArtifact.taskId === task.task_id && openArtifact.name === it.name,
        }"
        @click="it.exists && emit('open-artifact', { taskId: task.task_id, name: it.name })"
      >
        <span class="file-dot">{{ it.exists ? '●' : '○' }}</span>
        <span class="file-name">{{ it.name }}</span>
      </li>
    </ul>
  </li>
</template>
