<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
import { computed, onMounted, ref, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import ProjectBar from './ProjectBar.vue'
import TaskList from './TaskList.vue'
import PipelineView from './PipelineView.vue'
import QaPanel from './QaPanel.vue'
import ArtifactPanel from './ArtifactPanel.vue'
import RailIcon from '../../../shared/ui/RailIcon.vue'
import { patchTaskArchive } from '../../../api'
import { useLocalToggle } from '../../../shared/composables/useLocalToggle'
import { useAppSettings } from '../../../shared/composables/useAppSettings'
import {
  resolveCollapseMonitorSubSidebarOnOutside,
  resolveCollapseTaskExpandOnOutside,
} from '../../../../shared/schemas/appSettings'

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
])

const archiveError = ref('')

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

onClickOutside(subSidebarRef, () => {
  if (resolveCollapseTaskExpandOnOutside(settings.value)) taskListRef.value?.collapseAll()
  if (resolveCollapseMonitorSubSidebarOnOutside(settings.value)) {
    subSidebarCollapsed.value = true
  }
})

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
        />
      </template>
    </aside>
    <section class="monitor-content">
      <template v-if="selected">
        <div class="task-head">
          <h2>
            {{ selected.task_id }}
            <span v-if="selected.parent_task_id" class="subtask">{{ t('monitor.layout.subtaskOf', { id: selected.parent_task_id }) }}</span>
          </h2>
          <div class="badges">
            <span v-if="selected.auto_review" class="badge auto">auto-review</span>
            <span v-if="selected.review_round" class="badge">review round {{ selected.review_round }}/2</span>
            <span v-if="selected.hitl_pending" class="badge hitl">⏸ {{ selected.hitl_pending }}</span>
            <span v-if="!selected.state_ok" class="badge err">{{ t('monitor.layout.stateError') }}</span>
            <button
              v-if="selected.state_ok"
              class="btn-archive-detail"
              @click="toggleArchiveSelected"
            ><template v-if="selected.archived">{{ t('monitor.layout.unarchive') }}</template><template v-else><svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.25"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              ><rect x="2" y="2" width="12" height="3" rx="1" /><path d="M3 5v7.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5" /><path d="M6.5 8.5h3" /></svg> {{ t('monitor.layout.archive') }}</template></button>
          </div>
          <p v-if="archiveError" class="art-warning">{{ archiveError }}</p>
        </div>

        <QaPanel
          v-if="selected.has_qa"
          :qa="selected.qa"
          :task-id="selected.task_id"
          :project-id="selectedProjectId"
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
