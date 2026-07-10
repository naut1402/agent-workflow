<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { fetchProjects } from './api'
import { useLocalToggle } from './shared/composables/useLocalToggle'
import { useTaskPolling } from './features/monitor/composables/useTaskPolling'
import MonitorLayout from './features/monitor/components/MonitorLayout.vue'
import PipelineEditor from './features/pipeline-editor/components/PipelineEditor.vue'
import AgentEditor from './features/agent-editor/components/AgentEditor.vue'
import KnowledgePanel from './features/knowledge/components/KnowledgePanel.vue'
import RunnerConfigPanel from './features/runner/components/RunnerConfigPanel.vue'
import LogsPanel from './features/logs/components/LogsPanel.vue'
import RailIcon from './shared/ui/RailIcon.vue'

const SIDEBAR_KEY = 'dev-dashboard-sidebar-collapsed'
const PROJECT_KEY = 'dev-dashboard-selected-project'

// ── Mode ─────────────────────────────────────────────────────────────────────
const mode = ref('monitor')

const editorScope = ref('global')
const editorTaskId = ref('')

const { state: sidebarCollapsed, toggle: toggleSidebar } = useLocalToggle(false)

// Multi-project state. `selectedProjectId` (null = default project) drives which
// project's tasks the monitor view polls; persisted to localStorage.
const projects = ref([])
const defaultProjectId = ref(null)
const selectedProjectId = ref(loadSelectedProject())
const openArtifact = ref(null)

// Task polling (root/tasks/selectedId + connection state + 1500ms loop) lives in
// a composable so the shell stays thin and the loop is unit-testable.
const { root, tasks, selectedId, error, lastUpdated, connected, poll, start, stop } =
  useTaskPolling(() => selectedProjectId.value, 1500)

const selected = computed(
  () => tasks.value.find((t) => t.task_id === selectedId.value) || null,
)

function loadSidebarPref() {
  try {
    const v = localStorage.getItem(SIDEBAR_KEY)
    if (v === '1') sidebarCollapsed.value = true
  } catch { /* ignore */ }
}

function loadSelectedProject() {
  try {
    return localStorage.getItem(PROJECT_KEY) || null
  } catch {
    return null
  }
}

watch(selectedProjectId, (v) => {
  try {
    if (v) localStorage.setItem(PROJECT_KEY, v)
    else localStorage.removeItem(PROJECT_KEY)
  } catch { /* ignore */ }
})

async function loadProjects() {
  try {
    const data = await fetchProjects()
    projects.value = data.projects || []
    defaultProjectId.value = data.defaultId || null
    // Drop a stale selection (e.g. project removed in another tab).
    if (selectedProjectId.value && !projects.value.some((p) => p.id === selectedProjectId.value)) {
      selectedProjectId.value = null
    }
  } catch {
    // Registry endpoint may be absent in the legacy single-project dev mode —
    // ignore and fall back to the default project.
    projects.value = []
  }
}

function onSelectProject(id) {
  selectedProjectId.value = id
  selectedId.value = null // reset task selection when switching project
  poll()
}

function onProjectsChanged() {
  loadProjects()
}

watch(sidebarCollapsed, (v) => {
  try {
    localStorage.setItem(SIDEBAR_KEY, v ? '1' : '0')
  } catch { /* ignore */ }
})

watch(selectedId, () => {
  openArtifact.value = null
})

function handleOpenArtifact({ taskId, name }) {
  selectedId.value = taskId
  openArtifact.value = { taskId, name }
}

watch(mode, async (m) => {
  stop()
  if (m === 'monitor') start()
  else await poll()
})

onMounted(async () => {
  loadSidebarPref()
  await loadProjects()
  start()
})
onUnmounted(stop)
</script>

<template>
  <div class="layout" :class="{ 'layout-editor': mode === 'editor' }">
    <aside class="sidebar" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
      <header class="brand" :class="{ 'brand-collapsed': sidebarCollapsed }">
        <button
          type="button"
          class="sidebar-toggle rail-icon-btn"
          :title="sidebarCollapsed ? 'Mở sidebar' : 'Thu gọn sidebar'"
          :aria-expanded="!sidebarCollapsed"
          @click="toggleSidebar"
        >
          <RailIcon :name="sidebarCollapsed ? 'panelExpand' : 'panelCollapse'" />
        </button>
        <h1 v-if="!sidebarCollapsed">Dev Team</h1>
        <span
          v-if="!sidebarCollapsed"
          class="dot"
          :class="{ live: connected }"
          :title="connected ? 'live' : 'disconnected'"
        ></span>
      </header>
      <p v-if="!sidebarCollapsed" class="root" :title="root">{{ root || '…' }}</p>

      <div class="mode-toggle">
        <button
          class="mode-btn rail-icon-btn"
          :class="{ active: mode === 'monitor' }"
          title="Monitor"
          @click="mode = 'monitor'"
        >
          <RailIcon name="monitor" />
          <span v-if="!sidebarCollapsed" class="mode-btn-label">Monitor</span>
        </button>
        <button
          class="mode-btn rail-icon-btn"
          :class="{ active: mode === 'editor' }"
          title="Pipeline Editor"
          @click="mode = 'editor'"
        >
          <RailIcon name="pipeline" />
          <span v-if="!sidebarCollapsed" class="mode-btn-label">Pipeline Editor</span>
        </button>
        <button
          class="mode-btn rail-icon-btn"
          :class="{ active: mode === 'agentEditor' }"
          title="Agent Editor"
          @click="mode = 'agentEditor'"
        >
          <RailIcon name="agent" />
          <span v-if="!sidebarCollapsed" class="mode-btn-label">Agent Editor</span>
        </button>
        <button
          class="mode-btn rail-icon-btn"
          :class="{ active: mode === 'knowledge' }"
          title="Knowledge"
          @click="mode = 'knowledge'"
        >
          <RailIcon name="knowledge" />
          <span v-if="!sidebarCollapsed" class="mode-btn-label">Knowledge</span>
        </button>
        <button
          class="mode-btn rail-icon-btn"
          :class="{ active: mode === 'runner' }"
          title="Runner Config"
          @click="mode = 'runner'"
        >
          <RailIcon name="runner" />
          <span v-if="!sidebarCollapsed" class="mode-btn-label">Runner</span>
        </button>
        <button
          class="mode-btn rail-icon-btn"
          :class="{ active: mode === 'logs' }"
          title="Nhật ký"
          @click="mode = 'logs'"
        >
          <RailIcon name="logs" />
          <span v-if="!sidebarCollapsed" class="mode-btn-label">Nhật ký</span>
        </button>
      </div>

      <footer v-if="!sidebarCollapsed" class="status">
        <span v-if="error" class="err">⚠ {{ error }}</span>
        <span v-else-if="lastUpdated && mode === 'monitor'">cập nhật {{ lastUpdated }}</span>
        <span v-else-if="mode === 'editor'" class="muted">editor mode — polling paused</span>
        <span v-else-if="mode === 'agentEditor'" class="muted">agent editor — polling paused</span>
        <span v-else-if="mode === 'knowledge'" class="muted">knowledge — polling paused</span>
        <span v-else-if="mode === 'runner'" class="muted">runner config — polling paused</span>
        <span v-else-if="mode === 'logs'" class="muted">nhật ký — polling paused</span>
      </footer>
    </aside>

    <main v-if="mode === 'monitor'" class="main main-editor">
      <MonitorLayout
        :projects="projects"
        :default-project-id="defaultProjectId"
        :selected-project-id="selectedProjectId"
        :tasks="tasks"
        :selected-id="selectedId"
        :selected="selected"
        :open-artifact="openArtifact"
        :connected="connected"
        :error="error"
        :last-updated="lastUpdated"
        @select-project="onSelectProject"
        @projects-changed="onProjectsChanged"
        @select-task="selectedId = $event"
        @open-artifact="handleOpenArtifact"
        @qa-saved="poll"
        @hitl-action="poll"
        @task-archived="poll"
      />
    </main>

    <main v-else-if="mode === 'editor'" class="main main-editor">
      <PipelineEditor
        :scope="editorScope"
        :task-id="editorTaskId"
        :tasks="tasks"
        :project-id="selectedProjectId"
        :app-sidebar-collapsed="sidebarCollapsed"
        @update:scope="editorScope = $event"
        @update:task-id="editorTaskId = $event"
      />
    </main>

    <main v-else-if="mode === 'knowledge'" class="main main-editor">
      <KnowledgePanel />
    </main>

    <main v-else-if="mode === 'runner'" class="main main-editor">
      <RunnerConfigPanel />
    </main>

    <main v-else-if="mode === 'logs'" class="main main-editor">
      <LogsPanel />
    </main>

    <main v-else-if="mode === 'agentEditor'" class="main main-editor">
      <AgentEditor />
    </main>
  </div>
</template>
