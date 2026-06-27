<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { fetchTasks, fetchProjects } from './api.js'
import { useLocalToggle } from './lib/useLocalToggle.js'
import TaskList from './components/TaskList.vue'
import ProjectBar from './components/ProjectBar.vue'
import PipelineView from './components/PipelineView.vue'
import QaPanel from './components/QaPanel.vue'
import ArtifactPanel from './components/ArtifactPanel.vue'
import PipelineEditor from './components/PipelineEditor.vue'
import AgentEditor from './components/AgentEditor.vue'
import KnowledgePanel from './components/KnowledgePanel.vue'
import RunnerConfigPanel from './components/RunnerConfigPanel.vue'
import RailIcon from './components/RailIcon.vue'

const SIDEBAR_KEY = 'dev-dashboard-sidebar-collapsed'
const PROJECT_KEY = 'dev-dashboard-selected-project'

// ── Mode ─────────────────────────────────────────────────────────────────────
const mode = ref('monitor')

const editorScope = ref('global')
const editorTaskId = ref('')
const editorTaskSelect = ref('')
const editorTaskManual = ref('')

const { state: sidebarCollapsed, toggle: toggleSidebar } = useLocalToggle(false)

const POLL_MS = 1500

const root = ref('')
const tasks = ref([])
const selectedId = ref(null)

// Multi-project state. `selectedProjectId` (null = default project) drives which
// project's tasks the monitor view polls; persisted to localStorage.
const projects = ref([])
const defaultProjectId = ref(null)
const selectedProjectId = ref(loadSelectedProject())
const error = ref(null)
const lastUpdated = ref(null)
const connected = ref(false)
const openArtifact = ref(null)
let timer = null

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

async function poll() {
  try {
    const data = await fetchTasks(selectedProjectId.value)
    root.value = data.root
    tasks.value = data.tasks
    connected.value = true
    error.value = null
    lastUpdated.value = new Date().toLocaleTimeString()
    if (!selectedId.value && tasks.value.length) {
      const needsAttention = tasks.value.find((t) => t.has_qa || t.hitl_pending)
      selectedId.value = (needsAttention || tasks.value[0]).task_id
    }
  } catch (e) {
    connected.value = false
    error.value = String(e.message || e)
  }
}

watch(selectedId, () => {
  openArtifact.value = null
})

function handleOpenArtifact({ taskId, name }) {
  selectedId.value = taskId
  openArtifact.value = { taskId, name }
}

function onEditorTaskSelectChange() {
  if (editorTaskSelect.value === '__manual__') {
    editorTaskId.value = editorTaskManual.value
  } else {
    editorTaskId.value = editorTaskSelect.value
    editorTaskManual.value = ''
  }
}

watch(editorTaskManual, (v) => {
  if (editorTaskSelect.value === '__manual__') editorTaskId.value = v
})

watch(editorScope, (scope) => {
  if (scope === 'global') {
    editorTaskSelect.value = ''
    editorTaskManual.value = ''
    editorTaskId.value = ''
  }
})

watch(mode, async (m) => {
  clearInterval(timer)
  if (m === 'monitor') {
    poll()
    timer = setInterval(poll, POLL_MS)
  } else {
    await poll()
  }
})

onMounted(async () => {
  loadSidebarPref()
  await loadProjects()
  poll()
  timer = setInterval(poll, POLL_MS)
})
onUnmounted(() => clearInterval(timer))
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

      <div class="mode-toggle" :class="{ 'mode-toggle-collapsed': sidebarCollapsed }">
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
      </div>

      <div v-if="mode === 'editor' && !sidebarCollapsed" class="editor-scope">
        <label class="scope-label">Scope:</label>
        <select v-model="editorScope" class="scope-select">
          <option value="global">Global pipeline.yaml</option>
          <option value="task">Per-task</option>
        </select>
        <template v-if="editorScope === 'task'">
          <select
            v-model="editorTaskSelect"
            class="scope-select"
            @change="onEditorTaskSelectChange"
          >
            <option value="">— Chọn task —</option>
            <option v-for="t in tasks" :key="t.task_id" :value="t.task_id">
              {{ t.task_id }}
            </option>
            <option value="__manual__">Nhập thủ công…</option>
          </select>
          <input
            v-if="editorTaskSelect === '__manual__'"
            v-model="editorTaskManual"
            class="scope-task-input"
            placeholder="Task ID"
          />
        </template>
      </div>

      <ProjectBar
        v-if="mode === 'monitor' && !sidebarCollapsed"
        :projects="projects"
        :default-id="defaultProjectId"
        :selected-id="selectedProjectId"
        @select="onSelectProject"
        @changed="onProjectsChanged"
      />

      <TaskList
        v-if="mode === 'monitor' && !sidebarCollapsed"
        :tasks="tasks"
        :selected-id="selectedId"
        :open-artifact="openArtifact"
        @select="selectedId = $event"
        @open-artifact="handleOpenArtifact"
      />

      <footer v-if="!sidebarCollapsed" class="status">
        <span v-if="error" class="err">⚠ {{ error }}</span>
        <span v-else-if="lastUpdated && mode === 'monitor'">cập nhật {{ lastUpdated }}</span>
        <span v-else-if="mode === 'editor'" class="muted">editor mode — polling paused</span>
        <span v-else-if="mode === 'agentEditor'" class="muted">agent editor — polling paused</span>
        <span v-else-if="mode === 'knowledge'" class="muted">knowledge — polling paused</span>
        <span v-else-if="mode === 'runner'" class="muted">runner config — polling paused</span>
      </footer>
    </aside>

    <main v-if="mode === 'monitor'" class="main">
      <template v-if="selected">
        <div class="task-head">
          <h2>
            {{ selected.task_id }}
            <span v-if="selected.parent_task_id" class="subtask">↳ subtask của {{ selected.parent_task_id }}</span>
          </h2>
          <div class="badges">
            <span v-if="selected.auto_review" class="badge auto">auto-review</span>
            <span v-if="selected.review_round" class="badge">review round {{ selected.review_round }}/2</span>
            <span v-if="selected.hitl_pending" class="badge hitl">⏸ {{ selected.hitl_pending }}</span>
            <span v-if="!selected.state_ok" class="badge err">state lỗi</span>
          </div>
        </div>

        <QaPanel v-if="selected.has_qa" :qa="selected.qa" />

        <PipelineView :task="selected" />

        <ArtifactPanel
          :task="selected"
          :project-id="selectedProjectId"
          :open-artifact="openArtifact && openArtifact.taskId === selected.task_id ? openArtifact : null"
        />
      </template>
      <div v-else class="empty">
        <p v-if="!tasks.length && connected">
          Chưa có task nào trong <code>.dev-team-agent/.dev-state/</code>.<br />
          Chạy <code>/dev-team-orchestrator &lt;task-id&gt;</code> để bắt đầu.
        </p>
        <p v-else-if="!connected">Đang kết nối tới dev server…</p>
        <p v-else>Chọn một task ở bên trái.</p>
      </div>
    </main>

    <main v-else-if="mode === 'editor'" class="main main-editor">
      <PipelineEditor
        :scope="editorScope"
        :task-id="editorTaskId"
        :app-sidebar-collapsed="sidebarCollapsed"
      />
    </main>

    <main v-else-if="mode === 'knowledge'" class="main main-editor">
      <KnowledgePanel />
    </main>

    <main v-else-if="mode === 'runner'" class="main main-editor">
      <RunnerConfigPanel />
    </main>

    <main v-else-if="mode === 'agentEditor'" class="main main-editor">
      <AgentEditor />
    </main>
  </div>
</template>
