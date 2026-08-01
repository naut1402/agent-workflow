<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, provide } from 'vue'
import { useI18n } from 'vue-i18n'
import { onClickOutside } from '@vueuse/core'
import { fetchProjects } from './features/settings/scripts/settingsApi'
import { fetchAutoscanConfig, runAutoscan } from './features/settings/scripts/SettingsDialogApi'
import { useLocalToggle } from './core/composables/useLocalToggle'
import { useAppSettings } from './core/composables/useAppSettings'
import { navigateToModeKey, reloadProjectsKey } from './core/shell/keys'
import {
  resolveCollapseAppSidebarOnOutside,
  resolveNotifyShowFloating,
  resolveNotifyShowSidebar,
} from './core/contracts/schemas/appSettings'
import { resolveAutoscanIntervalMs } from './core/contracts/schemas/autoscan'
import { useTaskPolling } from './features/monitor/composables/useTaskPolling'
import { useNotifications } from './features/notifications/composables/useNotifications'
import FloatingNotificationIcon from './features/notifications/components/FloatingNotificationIcon.vue'
import NotificationBell from './features/notifications/components/NotificationBell.vue'
import MonitorLayout from './features/monitor/components/MonitorLayout.vue'
import PipelineEditor from './features/pipeline-editor/components/PipelineEditor.vue'
import AgentEditor from './features/agent-editor/components/AgentEditor.vue'
import KnowledgePanel from './features/knowledge/components/KnowledgePanel.vue'
import RunnerConfigPanel from './features/runner/components/RunnerConfigPanel.vue'
import LogsPanel from './features/logs/components/LogsPanel.vue'
import QuickActionPanel from './features/quick-action/components/QuickActionPanel.vue'
import SettingsDialog from './features/settings/components/SettingsDialog.vue'
import CreateTaskDialog from './features/monitor/components/CreateTaskDialog.vue'
import FloatingChatButton from './features/nl-chat/components/FloatingChatButton.vue'
import RailIcon from './core/ui/RailIcon.vue'
import { APP_VERSION } from './core/lib/appVersion'

const SIDEBAR_KEY = 'dev-dashboard-sidebar-collapsed'
const PROJECT_KEY = 'dev-dashboard-selected-project'

const { t } = useI18n()

// ── Mode ─────────────────────────────────────────────────────────────────────
const mode = ref('monitor')
const settingsOpen = ref(false)

const editorScope = ref('global')
const editorTaskId = ref('')

const { state: sidebarCollapsed, toggle: toggleSidebar } = useLocalToggle(false)
const sidebarRef = ref<HTMLElement | null>(null)
const { settings } = useAppSettings()

// Ignore teleported modals so clicks inside them do not collapse the rail.
onClickOutside(
  sidebarRef,
  () => {
    if (resolveCollapseAppSidebarOnOutside(settings.value)) sidebarCollapsed.value = true
  },
  { ignore: ['.modal-backdrop'] },
)

// Central mode switch, so any nested wizard/panel (Agent Editor's Build NL
// gate, ArtifactPanel's QuickAction gate) can send the user to Runner mode
// without bubbling a custom event through every intermediate component.
provide(navigateToModeKey, (m: string) => {
  mode.value = m
})

// Multi-project state. `selectedProjectId` (null = default project) drives which
// project's tasks the monitor view polls; persisted to localStorage.
const projects = ref([])
const defaultProjectId = ref(null)
const selectedProjectId = ref(loadSelectedProject())
const openArtifact = ref(null)
const createTaskOpen = ref(false)

// Task polling (root/tasks/selectedId + connection state + 1500ms loop) lives in
// a composable so the shell stays thin and the loop is unit-testable.
const { root, tasks, selectedId, error, lastUpdated, connected, poll, start, stop } =
  useTaskPolling(() => selectedProjectId.value, 1500)

const selected = computed(
  () => tasks.value.find((t) => t.task_id === selectedId.value) || null,
)

// HITL-pending / QA-ready notifications, derived from the same polled `tasks`
// list — no separate transport needed, orchestrator- and dashboard-run tasks
// both surface these flags through `.dev-state/<id>.json` via `/api/tasks`.
const { history, unreadCount, markRead, markAllRead } = useNotifications(tasks)

const showSidebarNotification = computed(() => resolveNotifyShowSidebar(settings.value))
const showFloatingNotification = computed(() => resolveNotifyShowFloating(settings.value))

function onNotificationSelect(event: { id: string; taskId: string }) {
  markRead(event.id)
  mode.value = 'monitor'
  selectedId.value = event.taskId
}

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

/** Exposed so SettingsDialog can refresh the sidebar after an autoscan run. */
provide(reloadProjectsKey, loadProjects)

let autoscanTimer: ReturnType<typeof setInterval> | null = null

async function tickAutoscan() {
  try {
    const data = await fetchAutoscanConfig()
    const cfg = data.config || {}
    if (!cfg.enabled || !Array.isArray(cfg.whitelist) || !cfg.whitelist.length) return
    await runAutoscan()
    await loadProjects()
  } catch {
    /* ignore — autoscan must not break the shell */
  }
}

function stopAutoscanLoop() {
  if (autoscanTimer) {
    clearInterval(autoscanTimer)
    autoscanTimer = null
  }
}

async function startAutoscanLoop() {
  stopAutoscanLoop()
  let interval = 60_000
  try {
    const data = await fetchAutoscanConfig()
    const cfg = data.config || {}
    interval = resolveAutoscanIntervalMs(cfg)
    if (cfg.enabled && Array.isArray(cfg.whitelist) && cfg.whitelist.length) {
      await tickAutoscan()
    }
  } catch {
    /* ignore */
  }
  autoscanTimer = setInterval(() => {
    void tickAutoscan()
  }, interval)
}

function onAutoscanChanged() {
  void startAutoscanLoop()
}

function onProjectsChangedEvent() {
  void loadProjects()
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

async function onTaskDeleted(taskId: string) {
  if (selectedId.value === taskId) selectedId.value = null
  await poll()
}

function onCreateTaskOpen() {
  createTaskOpen.value = true
}

async function onTaskCreated({ taskId }: { taskId: string; jobId: string | null }) {
  createTaskOpen.value = false
  await poll()
  selectedId.value = taskId
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
  window.addEventListener('dev-dashboard:autoscan-changed', onAutoscanChanged)
  window.addEventListener('dev-dashboard:projects-changed', onProjectsChangedEvent)
  void startAutoscanLoop()
})
onUnmounted(() => {
  stop()
  stopAutoscanLoop()
  window.removeEventListener('dev-dashboard:autoscan-changed', onAutoscanChanged)
  window.removeEventListener('dev-dashboard:projects-changed', onProjectsChangedEvent)
})
</script>

<template>
  <div class="layout" :class="{ 'layout-editor': mode === 'editor' }">
    <aside ref="sidebarRef" class="sidebar" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
      <header class="brand" :class="{ 'brand-collapsed': sidebarCollapsed }">
        <button
          type="button"
          class="sidebar-toggle rail-icon-btn"
          :title="sidebarCollapsed ? t('common.sidebar.expand') : t('common.sidebar.collapse')"
          :aria-expanded="!sidebarCollapsed"
          @click="toggleSidebar"
        >
          <RailIcon :name="sidebarCollapsed ? 'panelExpand' : 'panelCollapse'" />
        </button>
        <h1 v-if="!sidebarCollapsed">{{ t('common.brand') }}</h1>
        <span
          v-if="!sidebarCollapsed"
          class="dot"
          :class="{ live: connected }"
          :title="connected ? t('common.sidebar.connected') : t('common.sidebar.disconnected')"
        ></span>
      </header>
      <p v-if="!sidebarCollapsed" class="root" :title="root">{{ root || '…' }}</p>

      <div class="mode-toggle">
        <button
          class="mode-btn rail-icon-btn"
          :class="{ active: mode === 'monitor' }"
          :title="t('common.modes.monitor')"
          @click="mode = 'monitor'"
        >
          <RailIcon name="monitor" />
          <span v-if="!sidebarCollapsed" class="mode-btn-label">{{ t('common.modes.monitor') }}</span>
        </button>
        <button
          class="mode-btn rail-icon-btn"
          :class="{ active: mode === 'editor' }"
          :title="t('common.modes.pipelineEditor')"
          @click="mode = 'editor'"
        >
          <RailIcon name="pipeline" />
          <span v-if="!sidebarCollapsed" class="mode-btn-label">{{ t('common.modes.pipelineEditor') }}</span>
        </button>
        <button
          class="mode-btn rail-icon-btn"
          :class="{ active: mode === 'agentEditor' }"
          :title="t('common.modes.agentEditor')"
          @click="mode = 'agentEditor'"
        >
          <RailIcon name="agent" />
          <span v-if="!sidebarCollapsed" class="mode-btn-label">{{ t('common.modes.agentEditor') }}</span>
        </button>
        <button
          class="mode-btn rail-icon-btn"
          :class="{ active: mode === 'quickAction' }"
          :title="t('common.modes.quickAction')"
          @click="mode = 'quickAction'"
        >
          <RailIcon name="quickAction" />
          <span v-if="!sidebarCollapsed" class="mode-btn-label">{{ t('common.modes.quickAction') }}</span>
        </button>
        <button
          class="mode-btn rail-icon-btn"
          :class="{ active: mode === 'knowledge' }"
          :title="t('common.modes.knowledge')"
          @click="mode = 'knowledge'"
        >
          <RailIcon name="knowledge" />
          <span v-if="!sidebarCollapsed" class="mode-btn-label">{{ t('common.modes.knowledge') }}</span>
        </button>
        <button
          class="mode-btn rail-icon-btn"
          :class="{ active: mode === 'runner' }"
          :title="t('common.modes.runnerConfig')"
          @click="mode = 'runner'"
        >
          <RailIcon name="runner" />
          <span v-if="!sidebarCollapsed" class="mode-btn-label">{{ t('common.modes.runner') }}</span>
        </button>
        <button
          class="mode-btn rail-icon-btn"
          :class="{ active: mode === 'logs' }"
          :title="t('common.modes.logs')"
          @click="mode = 'logs'"
        >
          <RailIcon name="logs" />
          <span v-if="!sidebarCollapsed" class="mode-btn-label">{{ t('common.modes.logs') }}</span>
        </button>
      </div>

      <div class="sidebar-footer">
        <NotificationBell
          v-if="showSidebarNotification"
          :unread-count="unreadCount"
          :history="history"
          @mark-all-read="markAllRead"
          @select="onNotificationSelect"
        />
        <footer v-if="!sidebarCollapsed" class="status">
          <span v-if="error" class="err">⚠ {{ error }}</span>
          <span v-else-if="lastUpdated && mode === 'monitor'">{{ t('common.status.updated', { time: lastUpdated }) }}</span>
          <span v-else-if="mode === 'editor'" class="muted">{{ t('common.status.paused.editor') }}</span>
          <span v-else-if="mode === 'agentEditor'" class="muted">{{ t('common.status.paused.agentEditor') }}</span>
          <span v-else-if="mode === 'quickAction'" class="muted">{{ t('common.status.paused.quickAction') }}</span>
          <span v-else-if="mode === 'knowledge'" class="muted">{{ t('common.status.paused.knowledge') }}</span>
          <span v-else-if="mode === 'runner'" class="muted">{{ t('common.status.paused.runner') }}</span>
          <span v-else-if="mode === 'logs'" class="muted">{{ t('common.status.paused.logs') }}</span>
        </footer>
        <button
          type="button"
          class="settings-btn mode-btn rail-icon-btn"
          :title="t('common.sidebar.settings')"
          aria-haspopup="dialog"
          :aria-expanded="settingsOpen"
          @click="settingsOpen = true"
        >
          <RailIcon name="settings" />
          <span v-if="!sidebarCollapsed" class="mode-btn-label">{{ t('common.sidebar.settings') }}</span>
        </button>
        <span
          class="app-version"
          :title="t('common.sidebar.version', { version: APP_VERSION })"
        >v{{ APP_VERSION }}</span>
      </div>
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
        @task-deleted="onTaskDeleted"
        @create-task="onCreateTaskOpen"
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

    <main v-else-if="mode === 'quickAction'" class="main main-editor">
      <QuickActionPanel :project-id="selectedProjectId" />
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

    <FloatingNotificationIcon
      v-if="showFloatingNotification"
      :unread-count="unreadCount"
      :history="history"
      @mark-all-read="markAllRead"
      @select="onNotificationSelect"
    />

    <FloatingChatButton :project-id="selectedProjectId" />

    <SettingsDialog v-if="settingsOpen" @close="settingsOpen = false" />
    <CreateTaskDialog
      v-if="createTaskOpen"
      :project-id="selectedProjectId"
      @close="createTaskOpen = false"
      @created="onTaskCreated"
    />
  </div>
</template>
