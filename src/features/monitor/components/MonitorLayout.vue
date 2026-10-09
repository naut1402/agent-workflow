<script setup lang="ts">
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import { computed, ref, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import ProjectBar from './ProjectBar.vue'
import TaskList from './TaskList.vue'
import PipelineView from './PipelineView.vue'
import QaPanel from './QaPanel.vue'
import ArtifactPanel from './ArtifactPanel.vue'
import Icon from '../../../frontend/ui/Icon.vue'
import CScreenLayout from '../../../frontend/ui/CScreenLayout.vue'
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
import { useAppSettings } from '../../../frontend/composables/useAppSettings'
import { useApiAction } from '../../../frontend/composables/useApiAction'
import CLoadingOverlay from '../../../frontend/ui/CLoadingOverlay.vue'
import {
  resolveCollapseMonitorSubSidebarOnOutside,
  resolveCollapseTaskExpandOnOutside,
} from '../../../frontend/configs/appSettings'

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
const { pending: deleting, run: runDelete } = useApiAction()
const needsRepair = computed(() => taskNeedsStateRepair(props.selected))

const worktree = ref<any>(null)
const worktreeAmbiguous = ref(false)
const worktreeError = ref('')
const cleaning = ref(false)

const canCleanWorktree = computed(
  () => !!worktree.value && !worktreeAmbiguous.value && isFinishedTaskState(props.selected),
)

// xem docs/architecture/code/monitor.md §26
async function loadWorktree(taskId: string | null, projectId: string | null) {
  worktree.value = null
  worktreeAmbiguous.value = false
  if (!taskId) return
  try {
    const r: any = await fetchTaskWorktree(taskId, projectId ?? undefined)
    if (props.selected?.task_id !== taskId) return
    if ((props.selectedProjectId ?? null) !== projectId) return
    worktree.value = r?.worktree ?? null
    worktreeAmbiguous.value = !!r?.ambiguous
  } catch {
    worktree.value = null
  }
}

// xem docs/architecture/code/monitor.md §26
watch(
  [() => props.selected?.task_id ?? null, () => props.selectedProjectId ?? null],
  ([id, projectId]) => {
    worktreeError.value = ''
    loadWorktree(id, projectId)
  },
  { immediate: true },
)

const subSidebarRef = ref<HTMLElement | null>(null)
const taskListRef = ref<InstanceType<typeof TaskList> | null>(null)
const { settings } = useAppSettings()

// xem docs/architecture/code/monitor.md §27
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
  // xem docs/architecture/code/monitor.md §27
  { ignore: ['.modal-backdrop'] },
)

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
  await runDelete(async () => {
    archiveError.value = ''
    // xem docs/architecture/code/monitor.md §21
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
    }
  })
}

async function worktreeConfirmMessage(
  taskId: string,
  projectId: string | null,
  wt: any,
): Promise<string> {
  const running = await hasInFlightJob(taskId, projectId)
  const key = running
    ? 'monitor.layout.confirmCleanWorktreeRunning'
    : 'monitor.layout.confirmCleanWorktree'
  return t(key, { path: wt.relPath || wt.path, branch: wt.branch || '—' })
}

async function cleanWorktreeSelected() {
  const wt = worktree.value
  if (!wt || cleaning.value) return
  // xem docs/architecture/code/monitor.md §26
  const taskId = props.selected?.task_id
  if (!taskId) return
  const projectId = props.selectedProjectId ?? null
  worktreeError.value = ''
  cleaning.value = true
  try {
    if (!confirm(await worktreeConfirmMessage(taskId, projectId, wt))) return
    if (props.selected?.task_id !== taskId) return
    if ((props.selectedProjectId ?? null) !== projectId) return
    await cleanupTaskWorktree(taskId, projectId ?? undefined)
    await loadWorktree(taskId, projectId)
  } catch (e: any) {
    worktreeError.value = describeWorktreeError(e)
  } finally {
    cleaning.value = false
  }
}
</script>

<template>
  <CScreenLayout class="monitor-layout" :sub-sidebar-collapsed="subSidebarCollapsed">
    <template #left>
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
    </template>

    <template #main>
    <section class="monitor-content">
      <template v-if="selected">
        <div class="task-head">
          <CLoadingOverlay :active="deleting" />
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
          @open-artifact="emit('open-artifact', $event)"
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
    </template>
  </CScreenLayout>
</template>

<style scoped lang="scss">
.monitor-layout {
  flex: 1;
  height: 100%;
}
.monitor-layout :deep(.c-screen-layout__body--left-collapsed) {
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
