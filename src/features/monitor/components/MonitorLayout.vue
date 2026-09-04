<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { computed, onMounted, ref, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import ProjectBar from './ProjectBar.vue'
import TaskList from './TaskList.vue'
import PipelineView from './PipelineView.vue'
import QaPanel from './QaPanel.vue'
import ArtifactPanel from './ArtifactPanel.vue'
import RailIcon from '../../../core/ui/RailIcon.vue'
import Icon from '../../../core/ui/Icon.vue'
import { patchTaskArchive, deleteTask, repairTaskState } from '../scripts/monitorApi'
import { taskNeedsStateRepair } from '../lib/pipelineRunGuards'
import { taskDisplayName } from '../lib/taskDisplay'
import { useLocalToggle } from '../../../core/composables/useLocalToggle'
import { useAppSettings } from '../../../core/composables/useAppSettings'
import {
  resolveCollapseMonitorSubSidebarOnOutside,
  resolveCollapseTaskExpandOnOutside,
} from '../../../core/configs/appSettings'

const { t } = useI18nHelpers()
const SUB_SIDEBAR_KEY = 'dev-dashboard-monitor-subsidebar-collapsed'

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
})

const emit = defineEmits([
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
const needsRepair = computed(() => taskNeedsStateRepair(props.selected))

// Sub-sidebar collapse (mục 5) — cùng pattern App.vue (sidebar chính):
// useLocalToggle + localStorage key riêng.
const { state: subSidebarCollapsed, toggle: toggleSubSidebar } = useLocalToggle(false)

onMounted(() => {
  try {
    if (localStorage.getItem(SUB_SIDEBAR_KEY) === '1') subSidebarCollapsed.value = true
  } catch { /* ignore */ }
})

watch(subSidebarCollapsed, (v) => {
  try {
    localStorage.setItem(SUB_SIDEBAR_KEY, v ? '1' : '0')
  } catch { /* ignore */ }
})

// Setting mục 7 — auto-collapse file-list mở của TaskList khi click ra ngoài
// vùng .monitor-sub-sidebar (kể cả click vào artifact panel bên phải).
const subSidebarRef = ref<HTMLElement | null>(null)
const taskListRef = ref<InstanceType<typeof TaskList> | null>(null)
const { settings } = useAppSettings()

// Ignore teleported modals (FolderPicker, Settings, …): clicks there are outside
// the sub-sidebar DOM but must not collapse it — otherwise v-if unmounts ProjectBar
// and closes the picker mid-navigation.
onClickOutside(
  subSidebarRef,
  () => {
    if (resolveCollapseTaskExpandOnOutside(settings.value)) taskListRef.value?.collapseAll()
    if (resolveCollapseMonitorSubSidebarOnOutside(settings.value)) {
      subSidebarCollapsed.value = true
    }
  },
  { ignore: ['.modal-backdrop'] },
)

const monitorLayoutClass = computed(() => ({
  'monitor-layout--sub-collapsed': subSidebarCollapsed.value,
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
  archiveError.value = ''
  if (!confirm(t('monitor.layout.confirmDelete'))) return
  try {
    await deleteTask(props.selected.task_id, props.selectedProjectId ?? undefined)
    emit('task-deleted', props.selected.task_id)
  } catch (e: any) {
    archiveError.value = String(e.message || e)
  }
}
</script>

<template>
  <div class="monitor-layout" :class="monitorLayoutClass">
    <aside ref="subSidebarRef" class="monitor-sub-sidebar" :class="{ 'monitor-sub-sidebar--collapsed': subSidebarCollapsed }">
      <button
        type="button"
        class="monitor-sub-sidebar-collapse-btn rail-icon-btn"
        :title="subSidebarCollapsed ? t('monitor.layout.expandSubSidebar') : t('monitor.layout.collapseSubSidebar')"
        :aria-expanded="!subSidebarCollapsed"
        @click="toggleSubSidebar"
      >
        <RailIcon :name="subSidebarCollapsed ? 'panelExpand' : 'panelCollapse'" />
      </button>
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
            <button
              v-if="!selected.state_ok"
              type="button"
              class="btn-archive-detail"
              @click="deleteSelected"
            >{{ t('monitor.layout.deleteTask') }}</button>
          </div>
          <p v-if="archiveError" class="art-warning">{{ archiveError }}</p>
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
.monitor-layout.monitor-layout--sub-collapsed {
  grid-template-columns: 48px 1fr;
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
  padding: 10px 6px;
  align-items: center;
}
.monitor-sub-sidebar-collapse-btn {
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--muted);
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
  margin: 0 0 8px;
}
.monitor-sub-sidebar--collapsed .monitor-sub-sidebar-collapse-btn { margin: 0; }
.monitor-sub-sidebar-collapse-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: rgba(var(--accent-rgb), 0.08);
}
.monitor-content {
  overflow-y: auto;
  padding: 16px 20px;
  min-height: 0;
}
</style>
