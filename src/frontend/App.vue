<script setup lang="ts">
import { useI18nHelpers } from './composables/useI18nHelpers'
import { ref, computed, watch, onMounted, onUnmounted, provide, inject } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { fetchProjects } from '../features/monitor/scripts/monitorApi'
import { fetchAutoscanConfig, runAutoscan, fetchLoggingConfig } from '../features/settings/scripts/SettingsDialogApi'
import { useLocalToggle } from './composables/useLocalToggle'
import { useAppSettings } from './composables/useAppSettings'
import { canNavigateToModeKey, navigateToModeKey, reloadProjectsKey } from './shell/keys'
import { containerKey } from './shell/containerKey'
import { modeRegistryToken, type ModeEntry, type ShellContext } from './shell/modeRegistry'
import { modeAccessToken } from './shell/modeAccess'
import { useSubSidebarCollapse } from './shell/useSubSidebarCollapse'
import {
  resolveCollapseAppSidebarOnOutside,
  resolveNotifyShowFloating,
  resolveNotifyShowSidebar,
} from './configs/appSettings'
import { resolveAutoscanIntervalMs } from '../features/settings/schemas/autoscan'
import { useTaskPolling } from '../features/monitor/composables/useTaskPolling'
import { useNotifications } from '../features/notifications/composables/useNotifications'
import { useRunningJobs } from '../features/running-jobs/composables/useRunningJobs'
import FloatingNotificationIcon from '../features/notifications/components/FloatingNotificationIcon.vue'
import FloatingRunningJobsIcon from '../features/running-jobs/components/FloatingRunningJobsIcon.vue'
import NotificationBell from '../features/notifications/components/NotificationBell.vue'
import SettingsDialog from '../features/settings/components/SettingsDialog.vue'
import CreateTaskDialog from '../features/monitor/components/CreateTaskDialog.vue'
import FloatingChatButton from '../features/nl-chat/components/FloatingChatButton.vue'
import RailIcon from './ui/RailIcon.vue'
import { APP_VERSION } from './lib/appVersion'

const container = inject(containerKey)
if (!container) {
  throw new Error('App.vue: container chưa được provide — kiểm tra installPlugins() ở main.ts')
}
const modeRegistry = container.resolve(modeRegistryToken)
const modeAccess = container.resolve(modeAccessToken)

const SIDEBAR_KEY = 'dev-dashboard-sidebar-collapsed'
const PROJECT_KEY = 'dev-dashboard-selected-project'

const { t } = useI18nHelpers()

const FALLBACK_MODE = 'monitor'

const mode = ref(FALLBACK_MODE)
const settingsOpen = ref(false)
const showLogsTab = ref(true)

const editorScope = ref('global')
const editorTaskId = ref('')

const { state: sidebarCollapsed, toggle: toggleSidebar } = useLocalToggle(false)
const sidebarRef = ref<HTMLElement | null>(null)
const { settings } = useAppSettings()

const allModes = modeRegistry.listModes()
const subSidebar = useSubSidebarCollapse(allModes)

function onModeClick(m: ModeEntry) {
  if (mode.value !== m.key) {
    setMode(m.key)
    return
  }
  subSidebar.toggle(m.key)
}

function modeBtnExpanded(m: ModeEntry): boolean | undefined {
  if (mode.value !== m.key || !subSidebar.has(m.key)) return undefined
  return !subSidebar.isCollapsed(m.key)
}

function modeBtnTitle(m: ModeEntry): string {
  const label = t(m.titleKey ?? m.labelKey)
  if (mode.value !== m.key || !subSidebar.has(m.key)) return label
  const action = subSidebar.isCollapsed(m.key)
    ? t('common.sidebar.expandSubSidebar')
    : t('common.sidebar.collapseSubSidebar')
  return `${label} — ${action}`
}

onClickOutside(
  sidebarRef,
  () => {
    if (resolveCollapseAppSidebarOnOutside(settings.value)) sidebarCollapsed.value = true
  },
  { ignore: ['.modal-backdrop'] },
)

provide(navigateToModeKey, setMode)

provide(canNavigateToModeKey, isModeReachable)

const projects = ref([])
const defaultProjectId = ref(null)
const selectedProjectId = ref(loadSelectedProject())
const openArtifact = ref(null)
const createTaskOpen = ref(false)

const { root, tasks, selectedId, error, lastUpdated, connected, poll, start, stop } =
  useTaskPolling(() => selectedProjectId.value)

const selected = computed(
  () => tasks.value.find((t) => t.task_id === selectedId.value) || null,
)

const { history, unreadCount, markRead, markAllRead } = useNotifications(tasks)

const {
  grouped: runningJobsGrouped,
  runningCount,
  start: startRunningJobs,
  stop: stopRunningJobs,
} = useRunningJobs()

const showSidebarNotification = computed(() => resolveNotifyShowSidebar(settings.value))
const showFloatingNotification = computed(() => resolveNotifyShowFloating(settings.value))

function onNotificationSelect(event: { id: string; taskId: string }) {
  markRead(event.id)
  setMode(FALLBACK_MODE)
  selectedId.value = event.taskId
}

function onRunningJobSelect(taskId: string) {
  setMode(FALLBACK_MODE)
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
    if (selectedProjectId.value && !projects.value.some((p) => p.id === selectedProjectId.value)) {
      selectedProjectId.value = null
    }
  } catch {
    projects.value = []
  }
}

function onSelectProject(id) {
  selectedProjectId.value = id
  selectedId.value = null
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
    /* ignore */
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
  } catch {
    showLogsTab.value = true
  }
}

function onModesChanged(ev: Event) {
  const detail = (ev as CustomEvent).detail
  if (detail && typeof detail === 'object') modeAccess.applyOverrides(detail)
  else void modeAccess.load()
}

function onLoggingChanged(ev: Event) {
  const detail = (ev as CustomEvent).detail
  if (detail && typeof detail.showLogsTab === 'boolean') {
    showLogsTab.value = detail.showLogsTab
  } else {
    void loadLoggingPrefs()
  }
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
  subSidebar,
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
  allModes.filter(
    (m) =>
      modeAccess.canAccessMode(m.key, { shell: shellContext.value }) &&
      (!m.visible || m.visible(shellContext.value)),
  ),
)

function isModeReachable(key: string): boolean {
  return modes.value.some((m) => m.key === key)
}

function setMode(key: string): void {
  if (!isModeReachable(key)) return
  mode.value = key
}

const reachableModeKeys = computed(() => modes.value.map((m) => m.key).join('|'))

watch(reachableModeKeys, () => {
  if (!modes.value.some((m) => m.key === mode.value)) setMode(FALLBACK_MODE)
})
const activeMode = computed(() => modeRegistry.getMode(mode.value))
const chatShellModeLabel = computed(() => (activeMode.value ? t(activeMode.value.labelKey) : null))

watch(selectedProjectId, () => {
  stop()
  start()
})

onMounted(async () => {
  loadSidebarPref()
  await loadProjects()
  void loadLoggingPrefs()
  void modeAccess.load()
  start()
  startRunningJobs()
  window.addEventListener('dev-dashboard:autoscan-changed', onAutoscanChanged)
  window.addEventListener('dev-dashboard:projects-changed', onProjectsChangedEvent)
  window.addEventListener('dev-dashboard:logging-changed', onLoggingChanged)
  window.addEventListener('dev-dashboard:modes-changed', onModesChanged)
  void startAutoscanLoop()
})
onUnmounted(() => {
  stop()
  stopRunningJobs()
  stopAutoscanLoop()
  window.removeEventListener('dev-dashboard:autoscan-changed', onAutoscanChanged)
  window.removeEventListener('dev-dashboard:projects-changed', onProjectsChangedEvent)
  window.removeEventListener('dev-dashboard:logging-changed', onLoggingChanged)
  window.removeEventListener('dev-dashboard:modes-changed', onModesChanged)
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

      <div class="mode-toggle">
        <button
          v-for="m in modes"
          :key="m.key"
          class="mode-btn rail-icon-btn"
          :class="{ active: mode === m.key }"
          :title="modeBtnTitle(m)"
          :aria-expanded="modeBtnExpanded(m)"
          @click="onModeClick(m)"
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

    <FloatingChatButton
      :project-id="selectedProjectId"
      :connected="connected"
      :shell-mode-label="chatShellModeLabel"
      :shell-task-id="selectedId"
    />

    <SettingsDialog v-if="settingsOpen" :mode-catalog="allModes" @close="settingsOpen = false" />
    <CreateTaskDialog
      v-if="createTaskOpen"
      :project-id="selectedProjectId"
      @close="createTaskOpen = false"
      @created="onTaskCreated"
    />
  </div>
</template>
