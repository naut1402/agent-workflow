<script setup lang="ts">
import { useI18nHelpers } from './core/composables/useI18nHelpers'
import { ref, computed, watch, onMounted, onUnmounted, provide, inject } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { fetchProjects } from './features/monitor/scripts/monitorApi'
import { fetchAutoscanConfig, runAutoscan, fetchLoggingConfig } from './features/settings/scripts/SettingsDialogApi'
import { useLocalToggle } from './core/composables/useLocalToggle'
import { useAppSettings } from './core/composables/useAppSettings'
import { navigateToModeKey, reloadProjectsKey } from './core/shell/keys'
import { containerKey } from './core/shell/containerKey'
import { modeRegistryToken, type ShellContext } from './core/shell/modeRegistry'
import {
  resolveCollapseAppSidebarOnOutside,
  resolveNotifyShowFloating,
  resolveNotifyShowSidebar,
} from './core/configs/appSettings'
import { resolveAutoscanIntervalMs } from './features/settings/schemas/autoscan'
import { useTaskPolling } from './features/monitor/composables/useTaskPolling'
import { useNotifications } from './features/notifications/composables/useNotifications'
import { useRunningJobs } from './features/running-jobs/composables/useRunningJobs'
import FloatingNotificationIcon from './features/notifications/components/FloatingNotificationIcon.vue'
import FloatingRunningJobsIcon from './features/running-jobs/components/FloatingRunningJobsIcon.vue'
import NotificationBell from './features/notifications/components/NotificationBell.vue'
import SettingsDialog from './features/settings/components/SettingsDialog.vue'
import CreateTaskDialog from './features/monitor/components/CreateTaskDialog.vue'
import FloatingChatButton from './features/nl-chat/components/FloatingChatButton.vue'
import RailIcon from './core/ui/RailIcon.vue'
import { APP_VERSION } from './core/lib/appVersion'

const container = inject(containerKey)
if (!container) {
  throw new Error('App.vue: container chưa được provide — kiểm tra installPlugins() ở main.ts')
}
const modeRegistry = container.resolve(modeRegistryToken)

const SIDEBAR_KEY = 'dev-dashboard-sidebar-collapsed'
const PROJECT_KEY = 'dev-dashboard-selected-project'

const { t } = useI18nHelpers()

// ── Mode ─────────────────────────────────────────────────────────────────────
const mode = ref('monitor')
const settingsOpen = ref(false)
const showLogsTab = ref(true)

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

const {
  grouped: runningJobsGrouped,
  runningCount,
  start: startRunningJobs,
  stop: stopRunningJobs,
} = useRunningJobs(1500)

const showSidebarNotification = computed(() => resolveNotifyShowSidebar(settings.value))
const showFloatingNotification = computed(() => resolveNotifyShowFloating(settings.value))

function onNotificationSelect(event: { id: string; taskId: string }) {
  markRead(event.id)
  mode.value = 'monitor'
  selectedId.value = event.taskId
}

function onRunningJobSelect(taskId: string) {
  mode.value = 'monitor'
  selectedId.value = taskId
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

function onSelectTask(id: string | null) {
  selectedId.value = id
}

function onUpdateScope(scope: string) {
  editorScope.value = scope
}

function onUpdateTaskId(taskId: string) {
  editorTaskId.value = taskId
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

async function loadLoggingPrefs() {
  try {
    const data = await fetchLoggingConfig()
    const cfg = data.config || {}
    showLogsTab.value = cfg.showLogsTab !== false
    if (!showLogsTab.value && mode.value === 'logs') mode.value = 'monitor'
  } catch {
    showLogsTab.value = true
  }
}

function onLoggingChanged(ev: Event) {
  const detail = (ev as CustomEvent).detail
  if (detail && typeof detail.showLogsTab === 'boolean') {
    showLogsTab.value = detail.showLogsTab
  } else {
    void loadLoggingPrefs()
  }
  if (!showLogsTab.value && mode.value === 'logs') mode.value = 'monitor'
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

// State/hàm shell sở hữu, mode đọc/gọi qua `bindings(ctx)` của chính feature —
// App.vue không còn biết mode nào cần props/listener gì (xem registerMode.ts).
const shellContext = computed<ShellContext>(() => ({
  projects: projects.value,
  tasks: tasks.value,
  selectedId: selectedId.value,
  selected: selected.value,
  selectedProjectId: selectedProjectId.value,
  defaultProjectId: defaultProjectId.value,
  connected: connected.value,
  error: error.value,
  lastUpdated: lastUpdated.value,
  sidebarCollapsed: sidebarCollapsed.value,
  editorScope: editorScope.value,
  editorTaskId: editorTaskId.value,
  openArtifact: openArtifact.value,
  showLogsTab: showLogsTab.value,
  onSelectProject,
  onProjectsChanged,
  onSelectTask,
  onOpenArtifact: handleOpenArtifact,
  poll,
  onTaskDeleted,
  onCreateTaskOpen,
  onUpdateScope,
  onUpdateTaskId,
}))

const modes = computed(() =>
  modeRegistry.listModes().filter((m) => !m.visible || m.visible(shellContext.value)),
)
const activeMode = computed(() => modeRegistry.getMode(mode.value))

watch(mode, async (m) => {
  stop()
  if (m === 'monitor') start()
  else await poll()
})

onMounted(async () => {
  loadSidebarPref()
  await loadProjects()
  void loadLoggingPrefs()
  start()
  startRunningJobs()
  window.addEventListener('dev-dashboard:autoscan-changed', onAutoscanChanged)
  window.addEventListener('dev-dashboard:projects-changed', onProjectsChangedEvent)
  window.addEventListener('dev-dashboard:logging-changed', onLoggingChanged)
  void startAutoscanLoop()
})
onUnmounted(() => {
  stop()
  stopRunningJobs()
  stopAutoscanLoop()
  window.removeEventListener('dev-dashboard:autoscan-changed', onAutoscanChanged)
  window.removeEventListener('dev-dashboard:projects-changed', onProjectsChangedEvent)
  window.removeEventListener('dev-dashboard:logging-changed', onLoggingChanged)
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
          v-for="m in modes"
          :key="m.key"
          class="mode-btn rail-icon-btn"
          :class="{ active: mode === m.key }"
          :title="t(m.titleKey ?? m.labelKey)"
          @click="mode = m.key"
        >
          <RailIcon :name="m.icon" />
          <span v-if="!sidebarCollapsed" class="mode-btn-label">{{ t(m.labelKey) }}</span>
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
          <span v-else-if="activeMode?.statusKind === 'live' && lastUpdated">{{ t('common.status.updated', { time: lastUpdated }) }}</span>
          <span v-else-if="activeMode?.statusKind === 'paused'" class="muted">{{ t(`common.status.paused.${mode}`) }}</span>
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

    <template v-for="m in modes" :key="m.key">
      <main v-if="mode === m.key" class="main main-editor">
        <component :is="m.panel" v-bind="m.bindings?.(shellContext) ?? {}" />
      </main>
    </template>

    <FloatingRunningJobsIcon
      :running-count="runningCount"
      :groups="runningJobsGrouped.groups"
      :truncated="runningJobsGrouped.truncated"
      :hidden-task-count="runningJobsGrouped.hiddenTaskCount"
      @select="onRunningJobSelect"
    />

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
