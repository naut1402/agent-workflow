<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { patchTaskArchive, deleteTask } from '../../../api'

const props = defineProps({
  task: { type: Object, required: true },
  selectedId: { type: String, default: null },
  openArtifact: { type: Object, default: null }, // { taskId, name }
  isExpanded: { type: Boolean, default: false },
  projectId: { type: String, default: null },
  hideMissing: { type: Boolean, default: true },
})
const emit = defineEmits([
  'select', 'toggle-expand', 'open-artifact', 'task-archived', 'task-deleted', 'toggle-hide-missing',
])

const { t } = useI18n()
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
      emit('task-archived')
    } else {
      archiveError.value = String(e.message || e)
    }
  }
}

async function removeTask() {
  archiveError.value = ''
  if (!confirm(t('monitor.taskItem.confirmDelete'))) return
  try {
    await deleteTask(props.task.task_id, props.projectId ?? undefined)
    emit('task-deleted', props.task.task_id)
  } catch (e: any) {
    archiveError.value = String(e.message || e || t('monitor.taskItem.deleteError'))
  }
}

function selectTask() {
  emit('select', props.task.task_id)
  if (!props.isExpanded) emit('toggle-expand', props.task.task_id)
}

function taskStatusKey(task: any): 'error' | 'waiting' | 'done' | 'active' | 'pending' {
  if (!task.state_ok) return 'error'
  if (task.has_qa || task.hitl_pending) return 'waiting'
  if (task.current_phase === 'completed') return 'done'
  if (task.current_phase) return 'active'
  return 'pending'
}

function statusIcon(task: any): string {
  if (!task.state_ok) return '⚠'
  // has_qa: SVG chat icon in template (not a text glyph)
  if (task.has_qa) return ''
  if (task.hitl_pending) return '⏸'
  if (task.current_phase === 'completed') return '✓'
  if (task.current_phase) return '▶'
  return '○'
}

function isQaFlag(task: any): boolean {
  return !!(task.state_ok && task.has_qa)
}

function flagClass(task: any): string {
  if (!task.state_ok) return 'error'
  if (task.has_qa) return 'qa'
  if (task.hitl_pending) return 'hitl'
  return taskStatusKey(task)
}

const ORDER = [
  'investigate.md', 'investigate-po.md',
  'design.md', 'design-po.md',
  'phpstan.md', 'review.md', 'test-spec.md', 'pr-desc.md',
  'qa.md',
]

function allSortedArtifacts(task: any) {
  const a = task.artifacts || {}
  const names = Object.keys(a)
  names.sort((x, y) => {
    const ix = ORDER.indexOf(x)
    const iy = ORDER.indexOf(y)
    return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy) || x.localeCompare(y)
  })
  return names.map((name) => ({ name, ...a[name] }))
}

function sortedArtifacts(task: any) {
  const all = allSortedArtifacts(task)
  return props.hideMissing ? all.filter((it) => it.exists) : all
}

// Always counted against the UNFILTERED list so the toggle keeps reporting
// how many files are hidden even while hideMissing is on.
function hiddenCount(task: any) {
  return allSortedArtifacts(task).length - sortedArtifacts(task).length
}
</script>

<template>
  <li
    class="task-entry"
    :class="{ active: task.task_id === selectedId, attention: task.has_qa }"
  >
    <div class="task-row" @click="selectTask">
      <span
        class="expand-chevron"
        :class="{ open: isExpanded }"
        @click.stop="emit('toggle-expand', task.task_id)"
      >›</span>
      <span
        class="flag"
        :class="flagClass(task)"
        :title="!task.state_ok ? t('monitor.taskItem.stateError') : task.has_qa ? t('monitor.taskItem.flagQa') : task.hitl_pending ? t('monitor.taskItem.flagHitl') : undefined"
      >
        <svg
          v-if="isQaFlag(task)"
          class="flag-chat"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M20.5 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 20.5 12z" />
        </svg>
        <template v-else>{{ statusIcon(task) }}</template>
      </span>
      <span class="id" :class="'id-' + taskStatusKey(task)">{{ task.task_id }}</span>
      <button
        v-if="task.state_ok"
        class="btn-archive"
        :title="task.archived ? t('monitor.taskItem.unarchive') : t('monitor.taskItem.archive')"
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
      <button
        v-if="!task.state_ok"
        class="btn-delete"
        :title="t('monitor.taskItem.deleteTask')"
        @click.stop="removeTask"
      >✕</button>
    </div>
    <p v-if="archiveError" class="art-warning">{{ archiveError }}</p>

    <ul v-if="isExpanded" class="file-list">
      <li
        v-if="allSortedArtifacts(task).length"
        class="file-list-toggle"
        @click.stop="emit('toggle-hide-missing')"
      >{{
        hideMissing && hiddenCount(task) > 0
          ? t('monitor.fileList.showMissing', { count: hiddenCount(task) })
          : t('monitor.fileList.hideMissing')
      }}</li>
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
