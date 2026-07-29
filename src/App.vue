<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, provide } from 'vue'
import { useI18n } from 'vue-i18n'
import { onClickOutside } from '@vueuse/core'
import { fetchProjects, fetchAutoscanConfig, runAutoscan } from './api'
import { useLocalToggle } from './shared/composables/useLocalToggle'
import { useAppSettings } from './shared/composables/useAppSettings'
import {
  resolveCollapseAppSidebarOnOutside,
  resolveNotifyShowFloating,
  resolveNotifyShowSidebar,
} from '../shared/schemas/appSettings'
import { resolveAutoscanIntervalMs } from '../shared/schemas/autoscan'
import { useTaskPolling } from './features/monitor/composables/useTaskPolling'
import { useNotifications } from './features/notifications/composables/useNotifications'
import NotificationBell from './features/notifications/components/NotificationBell.vue'
import CreateTaskDialog from './features/monitor/components/CreateTaskDialog.vue'
import RailIcon from './shared/ui/RailIcon.vue'
import { APP_VERSION } from './shared/lib/appVersion'
import { useHostContext } from './shared/host/useHostContext'

const SIDEBAR_KEY = 'dev-dashboard-sidebar-collapsed'
const PROJECT_KEY = 'dev-dashboard-selected-project'

const { t } = useI18n()

// ── Mode (registry-driven — built-ins register via HostContext, see
// src/features/*/host.plugin.ts and issue #159) ────────────────────────────
const { modes, floatings, railActions } = useHostContext()
const mode = ref(modes.find((m) => m.default)?.id ?? modes[0]?.id ?? 'monitor')
const activeMode = computed(() => modes.find((m) => m.id === mode.value) ?? null)
const openRailAction = ref<string | null>(null)
const activeRailAction = computed(() => railActions.find((a) => a.id === openRailAction.value) ?? null)

/**
 * `t()`'s type is narrowed to the vi message schema (see shared/i18n/types.ts)
 * so it can only take literal keys known at compile time — but mode labels
 * come from the registry as plain `string`. Built-ins are trusted, in-repo
 * code (not user input), so the escape hatch is a deliberate, narrow one.
 */
function tr(key: string): string {
  return t(key as any)
}

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
provide('navigateToMode', (m: string) => {
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
provide('reloadProjects', loadProjects)

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

function onCreateTaskOpen() {
  createTaskOpen.value = true
}

async function onTaskCreated({ taskId }: { taskId: string; jobId: string | null }) {
  createTaskOpen.value = false
  await poll()
  selectedId.value = taskId
}

// Per-mode props/listeners the panel mount below binds via `v-bind`/`v-on`.
// This stays in App.vue (not the host.plugin.ts registration files) because
// the bound state (projects/tasks/selection/…) is owned by the shell, not by
// the individual feature modules — see design.md §4.2.
const activeModeBindings = computed(() => {
  switch (mode.value) {
    case 'monitor':
      return {
        props: {
          projects: projects.value,
          defaultProjectId: defaultProjectId.value,
          selectedProjectId: selectedProjectId.value,
          tasks: tasks.value,
          selectedId: selectedId.value,
          selected: selected.value,
          openArtifact: openArtifact.value,
          connected: connected.value,
          error: error.value,
          lastUpdated: lastUpdated.value,
        },
        listeners: {
          'select-project': onSelectProject,
          'projects-changed': onProjectsChanged,
          'select-task': (id: string) => {
            selectedId.value = id
          },
          'open-artifact': handleOpenArtifact,
          'qa-saved': poll,
          'hitl-action': poll,
          'task-archived': poll,
          'create-task': onCreateTaskOpen,
        },
      }
    case 'editor':
      return {
        props: {
          scope: editorScope.value,
          taskId: editorTaskId.value,
          tasks: tasks.value,
          projectId: selectedProjectId.value,
          appSidebarCollapsed: sidebarCollapsed.value,
        },
        listeners: {
          'update:scope': (v: string) => {
            editorScope.value = v
          },
          'update:taskId': (v: string) => {
            editorTaskId.value = v
          },
        },
      }
    case 'quickAction':
      return { props: { projectId: selectedProjectId.value }, listeners: {} }
    default:
      return { props: {}, listeners: {} }
  }
})

// Per-floating props/listeners, same rationale as `activeModeBindings` above.
// `show: false` hides the floating even though it stays registered (kept in
// sync with the existing `showFloatingNotification` setting toggle).
const floatingBindingsMap = computed<
  Record<string, { show?: boolean; props: Record<string, unknown>; listeners: Record<string, unknown> }>
>(() => ({
  notifications: {
    show: showFloatingNotification.value,
    props: { unreadCount: unreadCount.value, history: history.value },
    listeners: { 'mark-all-read': markAllRead, select: onNotificationSelect },
  },
}))

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
          v-for="m in modes"
          :key="m.id"
          class="mode-btn rail-icon-btn"
          :class="{ active: mode === m.id }"
          :title="tr(m.titleKey ?? m.labelKey)"
          @click="mode = m.id"
        >
          <RailIcon :name="m.icon" />
          <span v-if="!sidebarCollapsed" class="mode-btn-label">{{ tr(m.labelKey) }}</span>
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
          <span v-else-if="activeMode?.pausedStatusKey" class="muted">{{ tr(activeMode.pausedStatusKey) }}</span>
        </footer>
        <button
          v-for="a in railActions"
          :key="a.id"
          type="button"
          class="settings-btn mode-btn rail-icon-btn"
          :title="tr(a.labelKey)"
          aria-haspopup="dialog"
          :aria-expanded="openRailAction === a.id"
          @click="openRailAction = a.id"
        >
          <RailIcon :name="a.icon" />
          <span v-if="!sidebarCollapsed" class="mode-btn-label">{{ tr(a.labelKey) }}</span>
        </button>
        <span
          class="app-version"
          :title="t('common.sidebar.version', { version: APP_VERSION })"
        >v{{ APP_VERSION }}</span>
      </div>
    </aside>

    <main v-if="activeMode" class="main main-editor">
      <component
        :is="activeMode.entry"
        v-bind="activeModeBindings.props"
        v-on="activeModeBindings.listeners"
      />
    </main>

    <template v-for="f in floatings" :key="f.id">
      <component
        v-if="floatingBindingsMap[f.id]?.show !== false"
        :is="f.entry"
        v-bind="floatingBindingsMap[f.id]?.props"
        v-on="floatingBindingsMap[f.id]?.listeners"
      />
    </template>

    <component
      :is="activeRailAction.entry"
      v-if="activeRailAction"
      @close="openRailAction = null"
    />
    <CreateTaskDialog
      v-if="createTaskOpen"
      :project-id="selectedProjectId"
      @close="createTaskOpen = false"
      @created="onTaskCreated"
    />
  </div>
</template>
