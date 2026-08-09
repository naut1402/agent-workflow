<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { computed, inject, onMounted, onUnmounted, ref, type Ref } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { useAppSettings } from '../../../core/composables/useAppSettings'
import { useLocale } from '../../../core/composables/useLocale'
import { reloadProjectsKey } from '../../../core/shell/keys'
import {
  resolveArtifactViewMode,
  resolveChatFeedbackMode,
  resolveCollapseAppSidebarOnOutside,
  resolveCollapseMonitorSubSidebarOnOutside,
  resolveCollapseTaskExpandOnOutside,
  resolveNotificationsEnabled,
  resolveNotifyBrowserEnabled,
  resolveNotifyHitlPending,
  resolveNotifyQaReady,
  resolveNotificationUiPlacement,
  resolveNotifySoundEnabled,
  resolveThemePreference,
  type ChatFeedbackMode,
  type NotificationUiPlacement,
  type ThemePreference,
} from '../../../core/configs/appSettings'
import { fetchAutoscanConfig, saveAutoscanConfig, runAutoscan, fetchGithubTokensConfig, saveGithubTokensConfig, fetchLoggingConfig, saveLoggingConfig } from '../scripts/SettingsDialogApi'
import { parseGithubRepoRef } from '../schemas/githubTokens'
import FolderPickerDialog from '../../../core/ui/FolderPickerDialog.vue'
import CSelect from '../../../core/ui/CSelect.vue'

const emit = defineEmits<{ close: [] }>()

const { t } = useI18nHelpers()
const { settings, load, update } = useAppSettings()
const { locale, setLocale } = useLocale()

/** Optional: App.vue provides this so scan can refresh the project list. */
const reloadProjects = inject(reloadProjectsKey, undefined)

type SettingsGroupId = 'general' | 'projects' | 'notifications'

const selectedGroup = ref<SettingsGroupId>('general')

const GROUPS: { id: SettingsGroupId; labelKey: string }[] = [
  { id: 'general', labelKey: 'settings.groups.general' },
  { id: 'projects', labelKey: 'settings.groups.projects' },
  { id: 'notifications', labelKey: 'settings.groups.notifications' },
]

const autoscanInfoOpen = ref(false)
const autoscanInfoWrapRef = ref<HTMLElement | null>(null)

function selectGroup(id: SettingsGroupId) {
  selectedGroup.value = id
  autoscanInfoOpen.value = false
}

function toggleAutoscanInfo(e?: Event) {
  e?.stopPropagation()
  autoscanInfoOpen.value = !autoscanInfoOpen.value
}

onClickOutside(autoscanInfoWrapRef, () => {
  autoscanInfoOpen.value = false
})

const artifactViewMode = computed(() => resolveArtifactViewMode(settings.value))
const theme = computed(() => resolveThemePreference(settings.value))
const collapseOnOutsideClick = computed(() => resolveCollapseTaskExpandOnOutside(settings.value))
const collapseAppSidebarOnOutside = computed(() =>
  resolveCollapseAppSidebarOnOutside(settings.value),
)
const collapseMonitorSubSidebarOnOutside = computed(() =>
  resolveCollapseMonitorSubSidebarOnOutside(settings.value),
)

function setArtifactViewMode(mode: 'block' | 'full') {
  if (artifactViewMode.value === mode) return
  update({ artifactViewMode: mode })
}

const chatFeedbackMode = computed(() => resolveChatFeedbackMode(settings.value))

function setChatFeedbackMode(mode: ChatFeedbackMode) {
  if (chatFeedbackMode.value === mode) return
  update({ chatFeedbackMode: mode })
}

function setTheme(mode: ThemePreference) {
  if (theme.value === mode) return
  update({ theme: mode })
}

function toggleCollapseOnOutsideClick() {
  update({ collapseTaskExpandOnOutside: !collapseOnOutsideClick.value })
}

function toggleCollapseAppSidebarOnOutside() {
  update({ collapseAppSidebarOnOutside: !collapseAppSidebarOnOutside.value })
}

function toggleCollapseMonitorSubSidebarOnOutside() {
  update({
    collapseMonitorSubSidebarOnOutside: !collapseMonitorSubSidebarOnOutside.value,
  })
}

// ── Notifications ────────────────────────────────────────────────────────────

const notificationsEnabled = computed(() => resolveNotificationsEnabled(settings.value))
const notifyHitlPending = computed(() => resolveNotifyHitlPending(settings.value))
const notifyQaReady = computed(() => resolveNotifyQaReady(settings.value))
const notifyBrowserEnabled = computed(() => resolveNotifyBrowserEnabled(settings.value))
const notifySoundEnabled = computed(() => resolveNotifySoundEnabled(settings.value))
const notificationUiPlacement = computed(() => resolveNotificationUiPlacement(settings.value))
const notifyBrowserPermissionErr = ref(false)

function toggleNotificationsEnabled() {
  update({ notificationsEnabled: !notificationsEnabled.value })
}

function toggleNotifyHitlPending() {
  update({ notifyHitlPending: !notifyHitlPending.value })
}

function toggleNotifyQaReady() {
  update({ notifyQaReady: !notifyQaReady.value })
}

async function toggleNotifyBrowserEnabled() {
  notifyBrowserPermissionErr.value = false
  if (notifyBrowserEnabled.value) {
    update({ notifyBrowserEnabled: false })
    return
  }
  if (typeof Notification === 'undefined') return
  const permission =
    Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission === 'granted') {
    update({ notifyBrowserEnabled: true })
  } else {
    notifyBrowserPermissionErr.value = true
  }
}

function toggleNotifySoundEnabled() {
  update({ notifySoundEnabled: !notifySoundEnabled.value })
}

const notificationUiPlacementOptions = computed(() => [
  { value: 'both', label: t('settings.notifications.position.both') },
  { value: 'sidebar', label: t('settings.notifications.position.sidebar') },
  { value: 'floating', label: t('settings.notifications.position.floating') },
])

function onNotificationUiPlacementUpdate(value: string) {
  if (value === 'sidebar' || value === 'floating' || value === 'both') {
    update({ notificationUiPlacement: value as NotificationUiPlacement })
  }
}

// ── Logging (server-backed) ──────────────────────────────────────────────────

const showLogsTab = ref(true)
const logTypeAudit = ref(true)
const logTypeRequest = ref(true)
const logTypeJobs = ref(true)
const logTypeEvents = ref(true)
const loggingBusy = ref(false)
const loggingMsg = ref('')
const loggingErr = ref('')

async function loadLogging() {
  loggingErr.value = ''
  try {
    const data = await fetchLoggingConfig()
    const cfg = data.config || {}
    showLogsTab.value = cfg.showLogsTab !== false
    logTypeAudit.value = cfg.types?.audit !== false
    logTypeRequest.value = cfg.types?.request !== false
    logTypeJobs.value = cfg.types?.jobs !== false
    logTypeEvents.value = cfg.types?.events !== false
  } catch {
    loggingErr.value = t('settings.logging.loadError')
  }
}

async function persistLogging() {
  loggingBusy.value = true
  loggingMsg.value = ''
  loggingErr.value = ''
  try {
    const data = await saveLoggingConfig({
      showLogsTab: showLogsTab.value,
      types: {
        audit: logTypeAudit.value,
        request: logTypeRequest.value,
        jobs: logTypeJobs.value,
        events: logTypeEvents.value,
      },
    })
    const cfg = data.config || {}
    showLogsTab.value = cfg.showLogsTab !== false
    logTypeAudit.value = cfg.types?.audit !== false
    logTypeRequest.value = cfg.types?.request !== false
    logTypeJobs.value = cfg.types?.jobs !== false
    logTypeEvents.value = cfg.types?.events !== false
    loggingMsg.value = t('settings.logging.saved')
    window.dispatchEvent(
      new CustomEvent('dev-dashboard:logging-changed', {
        detail: {
          showLogsTab: showLogsTab.value,
          types: {
            audit: logTypeAudit.value,
            request: logTypeRequest.value,
            jobs: logTypeJobs.value,
            events: logTypeEvents.value,
          },
        },
      }),
    )
  } catch (e) {
    loggingErr.value = String((e as Error).message || e)
  } finally {
    loggingBusy.value = false
  }
}

function toggleShowLogsTab() {
  showLogsTab.value = !showLogsTab.value
  void persistLogging()
}

function toggleLogTypeAudit() {
  logTypeAudit.value = !logTypeAudit.value
  void persistLogging()
}

function toggleLogTypeRequest() {
  logTypeRequest.value = !logTypeRequest.value
  void persistLogging()
}

function toggleLogTypeJobs() {
  logTypeJobs.value = !logTypeJobs.value
  void persistLogging()
}

function toggleLogTypeEvents() {
  logTypeEvents.value = !logTypeEvents.value
  void persistLogging()
}

// ── Autoscan (server-backed) ─────────────────────────────────────────────────

const autoscanEnabled = ref(false)
const whitelist: Ref<string[]> = ref([])
const draftPath = ref('')
const pickerOpen = ref(false)
const autoscanBusy = ref(false)
const autoscanMsg = ref('')
const autoscanErr = ref('')

async function loadAutoscan() {
  autoscanErr.value = ''
  try {
    const data = await fetchAutoscanConfig()
    const cfg = data.config || {}
    autoscanEnabled.value = Boolean(cfg.enabled)
    whitelist.value = Array.isArray(cfg.whitelist) ? [...cfg.whitelist] : []
  } catch {
    autoscanErr.value = t('settings.autoscan.loadError')
  }
}

async function persistAutoscan() {
  autoscanBusy.value = true
  autoscanMsg.value = ''
  autoscanErr.value = ''
  try {
    const data = await saveAutoscanConfig({
      enabled: autoscanEnabled.value,
      whitelist: whitelist.value,
    })
    const cfg = data.config || {}
    autoscanEnabled.value = Boolean(cfg.enabled)
    whitelist.value = Array.isArray(cfg.whitelist) ? [...cfg.whitelist] : []
    autoscanMsg.value = t('settings.autoscan.saved')
    window.dispatchEvent(new CustomEvent('dev-dashboard:autoscan-changed'))
  } catch (e) {
    autoscanErr.value = String((e as Error).message || e)
  } finally {
    autoscanBusy.value = false
  }
}

function toggleAutoscanEnabled() {
  autoscanEnabled.value = !autoscanEnabled.value
  void persistAutoscan()
}

function addWhitelistPath(path?: string) {
  const p = (path ?? draftPath.value).trim()
  if (!p) {
    autoscanErr.value = t('settings.autoscan.pathRequired')
    return
  }
  if (!whitelist.value.includes(p)) whitelist.value = [...whitelist.value, p]
  draftPath.value = ''
  autoscanErr.value = ''
  void persistAutoscan()
}

function removeWhitelistPath(path: string) {
  whitelist.value = whitelist.value.filter((x) => x !== path)
  void persistAutoscan()
}

function onWhitelistPicked(path: string) {
  pickerOpen.value = false
  addWhitelistPath(path)
}

async function scanNow() {
  autoscanBusy.value = true
  autoscanMsg.value = ''
  autoscanErr.value = ''
  try {
    // Persist first so server whitelist matches UI.
    await saveAutoscanConfig({
      enabled: autoscanEnabled.value,
      whitelist: whitelist.value,
    })
    const data = await runAutoscan(whitelist.value)
    const report = data.report || {}
    const added = Array.isArray(report.added) ? report.added.length : 0
    const existing = Array.isArray(report.existing) ? report.existing.length : 0
    if (added > 0) {
      autoscanMsg.value = t('settings.autoscan.resultAdded', { count: added })
    } else if (existing > 0) {
      autoscanMsg.value = t('settings.autoscan.resultExisting', { count: existing })
    } else {
      autoscanMsg.value = t('settings.autoscan.resultNone')
    }
    await reloadProjects?.()
    window.dispatchEvent(new CustomEvent('dev-dashboard:projects-changed'))
  } catch (e) {
    autoscanErr.value = String((e as Error).message || e)
  } finally {
    autoscanBusy.value = false
  }
}

// ── GitHub repo tokens (server-backed) ───────────────────────────────────────

type GithubTokenRow = { repo: string; token: string }

const githubTokenRows: Ref<GithubTokenRow[]> = ref([])
const draftRepo = ref('')
const draftToken = ref('')
/** When set, the add form updates this existing slug instead of only appending. */
const editingRepo = ref<string | null>(null)
const githubTokensBusy = ref(false)
const githubTokensMsg = ref('')
const githubTokensErr = ref('')

async function loadGithubTokens() {
  githubTokensErr.value = ''
  try {
    const data = await fetchGithubTokensConfig()
    const cfg = data.config || {}
    githubTokenRows.value = Array.isArray(cfg.repos)
      ? cfg.repos.map((e: GithubTokenRow) => ({
          repo: String(e.repo ?? ''),
          token: String(e.token ?? ''),
        }))
      : []
  } catch {
    githubTokensErr.value = t('settings.githubTokens.loadError')
  }
}

async function persistGithubTokens() {
  githubTokensBusy.value = true
  githubTokensMsg.value = ''
  githubTokensErr.value = ''
  try {
    const data = await saveGithubTokensConfig({ repos: githubTokenRows.value })
    const cfg = data.config || {}
    githubTokenRows.value = Array.isArray(cfg.repos)
      ? cfg.repos.map((e: GithubTokenRow) => ({
          repo: String(e.repo ?? ''),
          token: String(e.token ?? ''),
        }))
      : []
    githubTokensMsg.value = t('settings.githubTokens.saved')
  } catch (e) {
    githubTokensErr.value = String((e as Error).message || e)
  } finally {
    githubTokensBusy.value = false
  }
}

function clearGithubTokenDraft() {
  draftRepo.value = ''
  draftToken.value = ''
  editingRepo.value = null
  githubTokensErr.value = ''
}

function beginEditGithubToken(row: GithubTokenRow) {
  editingRepo.value = row.repo
  draftRepo.value = row.repo
  draftToken.value = row.token
  githubTokensErr.value = ''
  githubTokensMsg.value = ''
}

function saveGithubTokenDraft() {
  const rawRepo = draftRepo.value.trim()
  const token = draftToken.value.trim()
  if (!rawRepo) {
    githubTokensErr.value = t('settings.githubTokens.repoRequired')
    return
  }
  const slug = parseGithubRepoRef(rawRepo)
  if (!slug) {
    githubTokensErr.value = t('settings.githubTokens.repoInvalid')
    return
  }
  if (!token) {
    githubTokensErr.value = t('settings.githubTokens.tokenRequired')
    return
  }
  const skip = new Set(
    [editingRepo.value, slug].filter((s): s is string => Boolean(s)).map((s) => s.toLowerCase()),
  )
  const without = githubTokenRows.value.filter((r) => !skip.has(r.repo.toLowerCase()))
  githubTokenRows.value = [...without, { repo: slug, token }]
  clearGithubTokenDraft()
  void persistGithubTokens()
}

function removeGithubToken(repo: string) {
  if (editingRepo.value === repo) clearGithubTokenDraft()
  githubTokenRows.value = githubTokenRows.value.filter((r) => r.repo !== repo)
  void persistGithubTokens()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (pickerOpen.value) {
      pickerOpen.value = false
      return
    }
    if (autoscanInfoOpen.value) {
      autoscanInfoOpen.value = false
      return
    }
    emit('close')
  }
}

onMounted(() => {
  load()
  void loadAutoscan()
  void loadGithubTokens()
  void loadLogging()
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="emit('close')">
      <div
        class="modal settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
      >
        <div class="modal-head">
          <span id="settings-dialog-title">{{ t('settings.title') }}</span>
          <button
            type="button"
            class="modal-close"
            :aria-label="t('settings.close')"
            @click="emit('close')"
          >
            ✕
          </button>
        </div>
        <div class="settings-layout">
          <nav class="settings-nav" :aria-label="t('settings.title')">
            <button
              v-for="g in GROUPS"
              :key="g.id"
              type="button"
              class="settings-nav-item"
              :class="{ active: selectedGroup === g.id }"
              :data-group="g.id"
              :aria-current="selectedGroup === g.id ? 'page' : undefined"
              @click="selectGroup(g.id)"
            >
              {{ t(g.labelKey) }}
            </button>
          </nav>
          <div class="settings-pane modal-body">
            <template v-if="selectedGroup === 'general'">
              <section class="settings-section">
                <h3 class="settings-section-title">{{ t('settings.theme.title') }}</h3>
                <p class="settings-section-desc">{{ t('settings.theme.desc') }}</p>
                <div
                  class="settings-radio-group"
                  role="radiogroup"
                  :aria-label="t('settings.theme.title')"
                >
                  <label class="settings-radio">
                    <input
                      type="radio"
                      name="theme"
                      value="system"
                      :checked="theme === 'system'"
                      @change="setTheme('system')"
                    />
                    {{ t('settings.theme.system') }}
                  </label>
                  <label class="settings-radio">
                    <input
                      type="radio"
                      name="theme"
                      value="light"
                      :checked="theme === 'light'"
                      @change="setTheme('light')"
                    />
                    {{ t('settings.theme.light') }}
                  </label>
                  <label class="settings-radio">
                    <input
                      type="radio"
                      name="theme"
                      value="dark"
                      :checked="theme === 'dark'"
                      @change="setTheme('dark')"
                    />
                    {{ t('settings.theme.dark') }}
                  </label>
                </div>
              </section>
              <section class="settings-section">
                <h3 class="settings-section-title">{{ t('common.language.title') }}</h3>
                <p class="settings-section-desc">{{ t('common.language.desc') }}</p>
                <div
                  class="settings-radio-group"
                  role="radiogroup"
                  :aria-label="t('common.language.title')"
                >
                  <label class="settings-radio">
                    <input
                      type="radio"
                      name="locale"
                      value="vi"
                      :checked="locale === 'vi'"
                      @change="setLocale('vi')"
                    />
                    {{ t('common.language.vi') }}
                  </label>
                  <label class="settings-radio">
                    <input
                      type="radio"
                      name="locale"
                      value="en"
                      :checked="locale === 'en'"
                      @change="setLocale('en')"
                    />
                    {{ t('common.language.en') }}
                  </label>
                </div>
              </section>
              <section class="settings-section">
                <h3 class="settings-section-title">{{ t('settings.artifact.title') }}</h3>
                <p class="settings-section-desc">{{ t('settings.artifact.desc') }}</p>
                <div
                  class="settings-radio-group"
                  role="radiogroup"
                  :aria-label="t('settings.artifact.groupLabel')"
                >
                  <label class="settings-radio">
                    <input
                      type="radio"
                      name="artifactViewMode"
                      value="block"
                      :checked="artifactViewMode === 'block'"
                      @change="setArtifactViewMode('block')"
                    />
                    {{ t('settings.artifact.block') }}
                  </label>
                  <label class="settings-radio">
                    <input
                      type="radio"
                      name="artifactViewMode"
                      value="full"
                      :checked="artifactViewMode === 'full'"
                      @change="setArtifactViewMode('full')"
                    />
                    {{ t('settings.artifact.full') }}
                  </label>
                </div>
              </section>
              <section class="settings-section">
                <h3 class="settings-section-title">{{ t('settings.chatFeedback.title') }}</h3>
                <p class="settings-section-desc">{{ t('settings.chatFeedback.desc') }}</p>
                <div
                  class="settings-radio-group"
                  role="radiogroup"
                  :aria-label="t('settings.chatFeedback.groupLabel')"
                >
                  <label class="settings-radio">
                    <input
                      type="radio"
                      name="chatFeedbackMode"
                      value="queue"
                      :checked="chatFeedbackMode === 'queue'"
                      @change="setChatFeedbackMode('queue')"
                    />
                    {{ t('settings.chatFeedback.queue') }}
                  </label>
                  <label class="settings-radio">
                    <input
                      type="radio"
                      name="chatFeedbackMode"
                      value="immediate"
                      :checked="chatFeedbackMode === 'immediate'"
                      @change="setChatFeedbackMode('immediate')"
                    />
                    {{ t('settings.chatFeedback.immediate') }}
                  </label>
                </div>
              </section>
              <section class="settings-section">
                <h3 class="settings-section-title">{{ t('settings.taskList.title') }}</h3>
                <p class="settings-section-desc">{{ t('settings.taskList.desc') }}</p>
                <label class="settings-checkbox">
                  <input
                    type="checkbox"
                    :checked="collapseOnOutsideClick"
                    @change="toggleCollapseOnOutsideClick"
                  />
                  {{ t('settings.taskList.collapseOnOutsideClick') }}
                </label>
              </section>
              <section class="settings-section">
                <h3 class="settings-section-title">{{ t('settings.sidebar.title') }}</h3>
                <p class="settings-section-desc">{{ t('settings.sidebar.desc') }}</p>
                <label class="settings-checkbox">
                  <input
                    type="checkbox"
                    :checked="collapseAppSidebarOnOutside"
                    @change="toggleCollapseAppSidebarOnOutside"
                  />
                  {{ t('settings.sidebar.collapseAppOnOutsideClick') }}
                </label>
                <label class="settings-checkbox">
                  <input
                    type="checkbox"
                    :checked="collapseMonitorSubSidebarOnOutside"
                    @change="toggleCollapseMonitorSubSidebarOnOutside"
                  />
                  {{ t('settings.sidebar.collapseMonitorSubOnOutsideClick') }}
                </label>
              </section>
              <section class="settings-section">
                <h3 class="settings-section-title">{{ t('settings.logging.title') }}</h3>
                <p class="settings-section-desc">{{ t('settings.logging.desc') }}</p>
                <label class="settings-checkbox">
                  <input
                    type="checkbox"
                    :checked="showLogsTab"
                    :disabled="loggingBusy"
                    @change="toggleShowLogsTab"
                  />
                  {{ t('settings.logging.showTab') }}
                </label>
                <template v-if="showLogsTab">
                  <p class="settings-section-desc">{{ t('settings.logging.typesDesc') }}</p>
                  <label class="settings-checkbox">
                    <input
                      type="checkbox"
                      :checked="logTypeAudit"
                      :disabled="loggingBusy"
                      @change="toggleLogTypeAudit"
                    />
                    {{ t('settings.logging.types.audit') }}
                  </label>
                  <label class="settings-checkbox">
                    <input
                      type="checkbox"
                      :checked="logTypeRequest"
                      :disabled="loggingBusy"
                      @change="toggleLogTypeRequest"
                    />
                    {{ t('settings.logging.types.request') }}
                  </label>
                  <label class="settings-checkbox">
                    <input
                      type="checkbox"
                      :checked="logTypeJobs"
                      :disabled="loggingBusy"
                      @change="toggleLogTypeJobs"
                    />
                    {{ t('settings.logging.types.jobs') }}
                  </label>
                  <label class="settings-checkbox">
                    <input
                      type="checkbox"
                      :checked="logTypeEvents"
                      :disabled="loggingBusy"
                      @change="toggleLogTypeEvents"
                    />
                    {{ t('settings.logging.types.events') }}
                  </label>
                </template>
                <p v-if="loggingMsg" class="settings-autoscan-msg">{{ loggingMsg }}</p>
                <p v-if="loggingErr" class="settings-autoscan-err">{{ loggingErr }}</p>
              </section>
            </template>

            <template v-else-if="selectedGroup === 'projects'">
              <section class="settings-section">
                <h3 class="settings-section-title">{{ t('settings.autoscan.title') }}</h3>
                <p class="settings-section-desc">{{ t('settings.autoscan.desc') }}</p>
                <div class="settings-checkbox-row">
                  <label class="settings-checkbox">
                    <input
                      type="checkbox"
                      :checked="autoscanEnabled"
                      :disabled="autoscanBusy"
                      @change="toggleAutoscanEnabled"
                    />
                    {{ t('settings.autoscan.enabled') }}
                  </label>
                  <div ref="autoscanInfoWrapRef" class="settings-info-wrap">
                    <button
                      type="button"
                      class="icon-btn settings-info-btn"
                      :class="{ active: autoscanInfoOpen }"
                      :aria-expanded="autoscanInfoOpen"
                      :aria-controls="'autoscan-info-tip'"
                      :aria-label="t('settings.autoscan.enabledInfoAria')"
                      @click="toggleAutoscanInfo"
                    >
                      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                        <circle
                          cx="8"
                          cy="8"
                          r="6.25"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.25"
                        />
                        <circle cx="8" cy="5.2" r="0.9" fill="currentColor" />
                        <path fill="currentColor" d="M7.25 7h1.5v4.75h-1.5z" />
                      </svg>
                    </button>
                    <div
                      v-if="autoscanInfoOpen"
                      id="autoscan-info-tip"
                      class="settings-info-tip"
                      role="tooltip"
                    >
                      {{ t('settings.autoscan.enabledInfo') }}
                    </div>
                  </div>
                </div>
              </section>
              <section class="settings-section">
                <h3 class="settings-section-title">{{ t('settings.autoscan.whitelistTitle') }}</h3>
                <p class="settings-section-desc">{{ t('settings.autoscan.whitelistDesc') }}</p>
                <ul class="settings-whitelist">
                  <li v-for="p in whitelist" :key="p" class="settings-whitelist-item">
                    <code class="settings-whitelist-path" :title="p">{{ p }}</code>
                    <span class="icon-btn-group">
                      <button
                        type="button"
                        class="icon-btn icon-btn-inline danger"
                        :title="t('settings.autoscan.removePath')"
                        :aria-label="t('settings.autoscan.removePath')"
                        :disabled="autoscanBusy"
                        @click="removeWhitelistPath(p)"
                      >
                        ×
                      </button>
                    </span>
                  </li>
                  <li v-if="!whitelist.length" class="settings-whitelist-empty">
                    {{ t('settings.autoscan.pathPlaceholder') }}
                  </li>
                </ul>
                <div class="settings-whitelist-add">
                  <input
                    v-model="draftPath"
                    class="settings-input"
                    :placeholder="t('settings.autoscan.pathPlaceholder')"
                    :disabled="autoscanBusy"
                    @keyup.enter="addWhitelistPath()"
                  />
                  <button
                    type="button"
                    class="icon-btn"
                    :title="t('settings.autoscan.browse')"
                    :aria-label="t('settings.autoscan.browse')"
                    :disabled="autoscanBusy"
                    @click="pickerOpen = true"
                  >
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M2 3h5l1 1h6v9H2V3zm1 2v7h10V5H3z"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    class="btn-ghost btn-sm"
                    :disabled="autoscanBusy"
                    @click="addWhitelistPath()"
                  >
                    {{ t('settings.autoscan.addPath') }}
                  </button>
                </div>
                <div class="settings-autoscan-actions">
                  <button
                    type="button"
                    class="btn-primary"
                    :disabled="autoscanBusy || !whitelist.length"
                    @click="scanNow"
                  >
                    {{ autoscanBusy ? t('settings.autoscan.scanning') : t('settings.autoscan.scanNow') }}
                  </button>
                </div>
                <p v-if="autoscanMsg" class="settings-autoscan-msg">{{ autoscanMsg }}</p>
                <p v-if="autoscanErr" class="settings-autoscan-err">⚠ {{ autoscanErr }}</p>
              </section>
              <section class="settings-section">
                <h3 class="settings-section-title">{{ t('settings.githubTokens.title') }}</h3>
                <p class="settings-section-desc">{{ t('settings.githubTokens.desc') }}</p>
                <ul class="settings-whitelist settings-github-tokens">
                  <li
                    v-for="row in githubTokenRows"
                    :key="row.repo"
                    class="settings-whitelist-item"
                    :class="{ 'is-editing': editingRepo === row.repo }"
                  >
                    <code class="settings-whitelist-path" :title="row.repo">{{ row.repo }}</code>
                    <span class="settings-token-mask" :title="t('settings.githubTokens.tokenSet')">
                      ••••••••
                    </span>
                    <span class="icon-btn-group">
                      <button
                        type="button"
                        class="icon-btn icon-btn-inline"
                        :title="t('settings.githubTokens.edit')"
                        :aria-label="t('settings.githubTokens.edit')"
                        :disabled="githubTokensBusy"
                        @click="beginEditGithubToken(row)"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        class="icon-btn icon-btn-inline danger"
                        :title="t('settings.githubTokens.remove')"
                        :aria-label="t('settings.githubTokens.remove')"
                        :disabled="githubTokensBusy"
                        @click="removeGithubToken(row.repo)"
                      >
                        ×
                      </button>
                    </span>
                  </li>
                  <li v-if="!githubTokenRows.length" class="settings-whitelist-empty">
                    {{ t('settings.githubTokens.empty') }}
                  </li>
                </ul>
                <div class="settings-whitelist-add settings-github-tokens-add">
                  <input
                    v-model="draftRepo"
                    class="settings-input"
                    :placeholder="t('settings.githubTokens.repoPlaceholder')"
                    :disabled="githubTokensBusy"
                    autocomplete="off"
                    @keyup.enter="saveGithubTokenDraft()"
                  />
                  <input
                    v-model="draftToken"
                    class="settings-input"
                    type="password"
                    :placeholder="t('settings.githubTokens.tokenPlaceholder')"
                    :disabled="githubTokensBusy"
                    autocomplete="off"
                    @keyup.enter="saveGithubTokenDraft()"
                  />
                  <button
                    type="button"
                    class="btn-ghost btn-sm"
                    :disabled="githubTokensBusy"
                    @click="saveGithubTokenDraft()"
                  >
                    {{
                      editingRepo
                        ? t('settings.githubTokens.saveEdit')
                        : t('settings.githubTokens.add')
                    }}
                  </button>
                  <button
                    v-if="editingRepo"
                    type="button"
                    class="btn-ghost btn-sm"
                    :disabled="githubTokensBusy"
                    @click="clearGithubTokenDraft()"
                  >
                    {{ t('settings.githubTokens.cancelEdit') }}
                  </button>
                </div>
                <p v-if="githubTokensMsg" class="settings-autoscan-msg">{{ githubTokensMsg }}</p>
                <p v-if="githubTokensErr" class="settings-autoscan-err">⚠ {{ githubTokensErr }}</p>
              </section>
            </template>

            <template v-else-if="selectedGroup === 'notifications'">
              <section class="settings-section">
                <h3 class="settings-section-title">{{ t('settings.notifications.title') }}</h3>
                <p class="settings-section-desc">{{ t('settings.notifications.desc') }}</p>
                <label class="settings-checkbox">
                  <input
                    type="checkbox"
                    :checked="notificationsEnabled"
                    @change="toggleNotificationsEnabled"
                  />
                  {{ t('settings.notifications.enabled') }}
                </label>
              </section>
              <section class="settings-section">
                <h3 class="settings-section-title">{{ t('settings.notifications.position.title') }}</h3>
                <p class="settings-section-desc">{{ t('settings.notifications.position.desc') }}</p>
                <div class="settings-select-wrap">
                  <CSelect
                    :model-value="notificationUiPlacement"
                    :options="notificationUiPlacementOptions"
                    :disabled="!notificationsEnabled"
                    :aria-label="t('settings.notifications.position.title')"
                    @update:model-value="onNotificationUiPlacementUpdate"
                  />
                </div>
              </section>
              <section class="settings-section">
                <h3 class="settings-section-title">{{ t('settings.notifications.events.title') }}</h3>
                <label class="settings-checkbox">
                  <input
                    type="checkbox"
                    :checked="notifyHitlPending"
                    :disabled="!notificationsEnabled"
                    @change="toggleNotifyHitlPending"
                  />
                  {{ t('settings.notifications.events.hitlPending') }}
                </label>
                <label class="settings-checkbox">
                  <input
                    type="checkbox"
                    :checked="notifyQaReady"
                    :disabled="!notificationsEnabled"
                    @change="toggleNotifyQaReady"
                  />
                  {{ t('settings.notifications.events.qaReady') }}
                </label>
              </section>
              <section class="settings-section">
                <h3 class="settings-section-title">{{ t('settings.notifications.browser.title') }}</h3>
                <label class="settings-checkbox">
                  <input
                    type="checkbox"
                    :checked="notifyBrowserEnabled"
                    :disabled="!notificationsEnabled"
                    @change="toggleNotifyBrowserEnabled"
                  />
                  {{ t('settings.notifications.browser.enabled') }}
                </label>
                <p v-if="notifyBrowserPermissionErr" class="settings-autoscan-err">
                  ⚠ {{ t('settings.notifications.browser.permissionDenied') }}
                </p>
              </section>
              <section class="settings-section">
                <h3 class="settings-section-title">{{ t('settings.notifications.sound.title') }}</h3>
                <label class="settings-checkbox">
                  <input
                    type="checkbox"
                    :checked="notifySoundEnabled"
                    :disabled="!notificationsEnabled"
                    @change="toggleNotifySoundEnabled"
                  />
                  {{ t('settings.notifications.sound.enabled') }}
                </label>
              </section>
            </template>
          </div>
        </div>
      </div>
    </div>

    <FolderPickerDialog
      v-if="pickerOpen"
      :initial-path="draftPath.trim() || undefined"
      @select="onWhitelistPicked"
      @close="pickerOpen = false"
    />
  </Teleport>
</template>
