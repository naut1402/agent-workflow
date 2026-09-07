<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { computed, ref, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import ProjectBar from './ProjectBar.vue'
import TaskList from './TaskList.vue'
import PipelineView from './PipelineView.vue'
import QaPanel from './QaPanel.vue'
import ArtifactPanel from './ArtifactPanel.vue'
import Icon from '../../../core/ui/Icon.vue'
import {
  patchTaskArchive,
  deleteTask,
  repairTaskState,
  fetchTaskWorktree,
  cleanupTaskWorktree,
  describeWorktreeError,
} from '../scripts/monitorApi'
import { isFinishedTaskState, taskNeedsStateRepair } from '../lib/pipelineRunGuards'
import { hasInFlightJob } from '../lib/taskInFlight'
import { taskDisplayName } from '../lib/taskDisplay'
import { useAppSettings } from '../../../core/composables/useAppSettings'
import {
  resolveCollapseMonitorSubSidebarOnOutside,
  resolveCollapseTaskExpandOnOutside,
} from '../../../core/configs/appSettings'

const { t } = useI18nHelpers()

const props = defineProps({
  projects: { type: Array, default: () => [] },
  defaultProjectId: { type: [String, null], default: null },
  selectedProjectId: { type: [String, null], default: null },
  tasks: { type: Array, default: () => [] },
  selectedId: { type: [String, null], default: null },
  selected: { type: Object, default: null },
  openArtifact: { type: Object, default: null },
  connected: { type: Boolean, default: false },
  error: { type: String, default: '' },
  lastUpdated: { type: String, default: '' },
  /** v-model từ shell — mode icon trên rail sidebar là control ẩn/hiện panel này. */
  subSidebarCollapsed: { type: Boolean, default: false },
})

const emit = defineEmits([
  'update:subSidebarCollapsed',
  'select-project',
  'projects-changed',
  'select-task',
  'open-artifact',
  'qa-saved',
  'hitl-action',
  'task-archived',
  'task-deleted',
  'create-task',
])

const archiveError = ref('')
const deleting = ref(false)
const needsRepair = computed(() => taskNeedsStateRepair(props.selected))

const worktree = ref<any>(null)
const worktreeAmbiguous = ref(false)
const worktreeError = ref('')
const cleaning = ref(false)

// Cleanup is offered only for tasks that already ended — a running step may
// still be writing into that worktree. The server enforces the same rule.
const canCleanWorktree = computed(
  () => !!worktree.value && !worktreeAmbiguous.value && isFinishedTaskState(props.selected),
)

async function loadWorktree(taskId: string | null) {
  worktree.value = null
  worktreeAmbiguous.value = false
  if (!taskId) return
  try {
    const r: any = await fetchTaskWorktree(taskId, props.selectedProjectId ?? undefined)
    // Poll 1.5s may have switched task between the two awaits — drop stale data.
    if (props.selected?.task_id !== taskId) return
    worktree.value = r?.worktree ?? null
    worktreeAmbiguous.value = !!r?.ambiguous
  } catch {
    // Swallowed on purpose: this is auxiliary info. Surfacing it would blink a
    // warning in `.task-head` on every task switch when the backend has no git.
    worktree.value = null
  }
}

watch(
  () => props.selected?.task_id ?? null,
  (id) => {
    worktreeError.value = ''
    loadWorktree(id)
  },
  { immediate: true },
)

// Setting mục 7 — auto-collapse file-list mở của TaskList khi click ra ngoài
// vùng .monitor-sub-sidebar (kể cả click vào artifact panel bên phải).
const subSidebarRef = ref<HTMLElement | null>(null)
const taskListRef = ref<InstanceType<typeof TaskList> | null>(null)
const { settings } = useAppSettings()

// Mode icon (trong `.sidebar`) giờ chính là nút toggle sub-sidebar, mà listener
// capture của onClickOutside chạy TRƯỚC @click của nút: nếu collapse ở đây thì
// @click sẽ toggle mở lại ⇒ nhánh "đang hiện → ẩn" chết. Chặn đúng nhánh đó chứ
// KHÔNG đưa '.sidebar' vào `ignore` — `ignore` triệt tiêu cả callback, kéo theo
// nhánh collapseTaskExpandOnOutside (setting độc lập) chết oan.
function isFromRailSidebar(event: Event) {
  return event.composedPath().some((el) => el instanceof Element && el.classList.contains('sidebar'))
}

onClickOutside(
  subSidebarRef,
  (event) => {
    if (resolveCollapseTaskExpandOnOutside(settings.value)) taskListRef.value?.collapseAll()
    if (!isFromRailSidebar(event) && resolveCollapseMonitorSubSidebarOnOutside(settings.value)) {
      emit('update:subSidebarCollapsed', true)
    }
  },
  // Ignore teleported modals (FolderPicker, Settings, …): clicks there are outside
  // the sub-sidebar DOM but must not collapse it — otherwise v-if unmounts ProjectBar
  // and closes the picker mid-navigation.
  { ignore: ['.modal-backdrop'] },
)

const monitorLayoutClass = computed(() => ({
  'monitor-layout--sub-collapsed': props.subSidebarCollapsed,
}))

async function toggleArchiveSelected() {
  if (!props.selected) return
  archiveError.value = ''
  try {
    await patchTaskArchive(
      props.selected.task_id,
      { archived: !props.selected.archived, mtime: props.selected.state_mtime },
      props.selectedProjectId ?? undefined,
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

async function repairSelected() {
  if (!props.selected) return
  archiveError.value = ''
  try {
    await repairTaskState(props.selected.task_id, props.selectedProjectId ?? undefined)
    emit('task-archived')
  } catch (e: any) {
    archiveError.value = String(e.message || e)
  }
}

async function deleteSelected() {
  if (!props.selected) return
  // `deleting` chặn double-click: handler async (dò job trước khi hỏi) nên không
  // có guard thì mỗi cú click là một hộp confirm + một lượt DELETE.
  if (deleting.value) return
  archiveError.value = ''
  deleting.value = true
  // Chụp id ngay đầu handler: poll 1.5s có thể đổi `selected` giữa hai lần await.
  const taskId = props.selected.task_id
  try {
    const running = await hasInFlightJob(taskId, props.selectedProjectId)
    const messageKey = running
      ? 'monitor.layout.confirmDeleteRunning'
      : 'monitor.layout.confirmDelete'
    if (!confirm(t(messageKey))) return
    await deleteTask(taskId, props.selectedProjectId ?? undefined)
    emit('task-deleted', taskId)
  } catch (e: any) {
    archiveError.value = String(e.message || e)
  } finally {
    deleting.value = false
  }
}

/** Text of the destructive confirm — stronger wording while a job is in flight. */
async function worktreeConfirmMessage(taskId: string, wt: any): Promise<string> {
  const running = await hasInFlightJob(taskId, props.selectedProjectId)
  const key = running
    ? 'monitor.layout.confirmCleanWorktreeRunning'
    : 'monitor.layout.confirmCleanWorktree'
  return t(key, { path: wt.relPath || wt.path, branch: wt.branch || '—' })
}

async function cleanWorktreeSelected() {
  const wt = worktree.value
  if (!wt || cleaning.value) return
  // Same reason as deleteSelected: the handler awaits, `selected` may move.
  const taskId = props.selected?.task_id
  if (!taskId) return
  worktreeError.value = ''
  cleaning.value = true
  try {
    if (!confirm(await worktreeConfirmMessage(taskId, wt))) return
    await cleanupTaskWorktree(taskId, props.selectedProjectId ?? undefined)
    await loadWorktree(props.selected?.task_id ?? null)
  } catch (e: any) {
    worktreeError.value = describeWorktreeError(e)
  } finally {
    cleaning.value = false
  }
}
</script>

<template>
  <div class="monitor-layout" :class="monitorLayoutClass">
    <aside ref="subSidebarRef" class="monitor-sub-sidebar" :class="{ 'monitor-sub-sidebar--collapsed': subSidebarCollapsed }">
      <template v-if="!subSidebarCollapsed">
        <ProjectBar
          :projects="projects"
          :default-id="defaultProjectId"
          :selected-id="selectedProjectId"
          @select="emit('select-project', $event)"
          @changed="emit('projects-changed')"
        />
        <TaskList
          ref="taskListRef"
          :tasks="tasks"
          :selected-id="selectedId"
          :open-artifact="openArtifact"
          :project-id="selectedProjectId"
          @select="emit('select-task', $event)"
          @open-artifact="emit('open-artifact', $event)"
          @task-archived="emit('task-archived')"
          @task-deleted="emit('task-deleted', $event)"
          @create-task="emit('create-task')"
        />
      </template>
    </aside>
    <section class="monitor-content">
      <template v-if="selected">
        <div class="task-head">
          <h2 :title="selected.task_id">
            {{ taskDisplayName(selected) }}
            <span v-if="selected.parent_task_id" class="subtask">{{ t('monitor.layout.subtaskOf', { id: selected.parent_task_id }) }}</span>
          </h2>
          <div class="badges">
            <span v-if="selected.auto_review" class="badge auto">auto-review</span>
            <span v-if="selected.review_round" class="badge">review round {{ selected.review_round }}/2</span>
            <span v-if="selected.hitl_pending" class="badge hitl">⏸ {{ selected.hitl_pending }}</span>
            <span v-if="needsRepair" class="badge err">{{ t('monitor.layout.stateError') }}</span>
            <button
              v-if="needsRepair"
              type="button"
              class="btn-archive-detail"
              :title="t('monitor.layout.repairStateTitle')"
              @click="repairSelected"
            >{{ t('monitor.layout.repairState') }}</button>
            <button
              v-if="selected.state_ok"
              class="btn-archive-detail"
              @click="toggleArchiveSelected"
            ><template v-if="selected.archived">{{ t('monitor.layout.unarchive') }}</template><template v-else><Icon name="archiveBox" :size="14" /> {{ t('monitor.layout.archive') }}</template></button>
            <span v-if="worktree" class="badge worktree" :title="worktree.path">
              {{ t('monitor.layout.worktreeBadge', { branch: worktree.branch || worktree.relPath }) }}
              <template v-if="worktree.dirty">⚠</template>
            </span>
            <span v-else-if="worktreeAmbiguous" class="badge err">{{ t('monitor.layout.worktreeAmbiguous') }}</span>
            <button
              v-if="canCleanWorktree"
              type="button"
              class="btn-archive-detail btn-clean-worktree"
              :disabled="cleaning"
              :title="t('monitor.layout.cleanWorktreeTitle')"
              :aria-label="t('monitor.layout.cleanWorktree')"
              @click="cleanWorktreeSelected"
            ><Icon name="trash" :size="14" /> {{ t('monitor.layout.cleanWorktree') }}</button>
            <button
              type="button"
              class="btn-archive-detail btn-delete-detail"
              :disabled="deleting"
              @click="deleteSelected"
            >{{ t('monitor.layout.deleteTask') }}</button>
          </div>
          <p v-if="archiveError" class="art-warning">{{ archiveError }}</p>
          <p v-if="worktreeError" class="art-warning">{{ worktreeError }}</p>
        </div>

        <QaPanel
          v-if="selected.has_qa"
          :qa="selected.qa"
          :task-id="selected.task_id"
          :project-id="selectedProjectId"
          :step-id="selected.current_phase"
          @saved="emit('qa-saved')"
        />

        <PipelineView
          :task="selected"
          :project-id="selectedProjectId"
          @hitl-action="emit('hitl-action')"
        />

        <ArtifactPanel
          :task="selected"
          :project-id="selectedProjectId"
          :open-artifact="openArtifact && openArtifact.taskId === selected.task_id ? openArtifact : null"
        />
      </template>
      <div v-else class="empty">
        <p v-if="!tasks.length && connected">
          {{ t('monitor.layout.emptyNoTasks') }} <code>.dev-team-agent/.dev-state/</code>.<br />
          {{ t('monitor.layout.emptyHint') }} <code>/dev-team-orchestrator &lt;task-id&gt;</code> {{ t('monitor.layout.emptyHintSuffix') }}
        </p>
        <p v-else-if="!connected">{{ t('monitor.layout.connecting') }}</p>
        <p v-else>{{ t('monitor.layout.selectTask') }}</p>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.monitor-layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  transition: grid-template-columns 0.2s ease;
}
// Thu về 0 chứ không 48px như bản cũ: dải đó chỉ chứa nút thu/phóng đã bỏ,
// giữ lại sẽ là một cột xám rỗng. Editor vẫn giữ dải icon vì còn Catalog/Rules.
.monitor-layout.monitor-layout--sub-collapsed {
  grid-template-columns: 0 1fr;
}
.monitor-sub-sidebar {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  background: var(--panel);
  padding: 12px;
  min-height: 0;
  overflow: hidden;
}
.monitor-sub-sidebar.monitor-sub-sidebar--collapsed {
  padding: 0;
  border-right: none;
}
.monitor-content {
  overflow-y: auto;
  padding: 16px 20px;
  min-height: 0;
}
</style>
