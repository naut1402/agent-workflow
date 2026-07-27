import { type Ref, computed, ref, watch } from 'vue'
import { i18n } from '../../../shared/i18n'
import { useAppSettings } from '../../../shared/composables/useAppSettings'
import {
  resolveNotificationsEnabled,
  resolveNotifyBrowserEnabled,
  resolveNotifyHitlPending,
  resolveNotifyQaReady,
  resolveNotifySoundEnabled,
} from '../../../../shared/schemas/appSettings'
import type { NotificationEvent, NotificationKind } from '../lib/notificationTypes'
import { sendBrowserNotification } from '../lib/browserNotification'
import { playNotificationSound } from '../lib/sound'

const READ_KEY = 'dashboard.notifications.read'
const HISTORY_CAP = 50

function loadReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY)
    const ids = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(ids) ? ids : [])
  } catch {
    return new Set()
  }
}

function saveReadIds(ids: Set<string>) {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...ids]))
  } catch {
    /* ignore */
  }
}

// Plain (non-component) composable → resolve strings via the app i18n
// singleton (see useQuickActionCatalog.ts) rather than useI18n(), since this
// is also called from unit tests without a mounted component/i18n plugin.
const t = i18n.global.t

/**
 * Derives HITL-pending / QA-ready notifications from the polled `tasks` list
 * (no backend endpoint — both orchestrator- and dashboard-run tasks already
 * surface these flags through `.dev-state/<id>.json` via `/api/tasks`).
 * Only edge transitions (flag flips to true) produce a NotificationEvent, so
 * a task that stays `hitl_pending` across many poll ticks doesn't re-notify.
 * Respects the user's notification settings (master switch, per-event-kind
 * opt-out, native browser notification, sound).
 */
export function useNotifications(tasks: Ref<any[]>) {
  const { settings } = useAppSettings()
  const readIds = loadReadIds()
  const history = ref<NotificationEvent[]>([])
  let prevFlags = new Map<string, { hitl: boolean; qa: boolean }>()

  function message(kind: NotificationKind, taskId: string) {
    return kind === 'qa_ready'
      ? t('notifications.message.qaReady', { taskId })
      : t('notifications.message.hitlPending', { taskId })
  }

  function pushEvent(taskId: string, kind: NotificationKind, detail: string | null) {
    const id = `${taskId}:${kind}`
    const read = readIds.has(id)
    const event: NotificationEvent = { id, taskId, kind, detail, createdAt: new Date().toISOString(), read }
    history.value = [event, ...history.value.filter((e) => e.id !== id)].slice(0, HISTORY_CAP)
    if (read) return
    if (resolveNotifyBrowserEnabled(settings.value)) sendBrowserNotification(id, message(kind, taskId))
    if (resolveNotifySoundEnabled(settings.value)) playNotificationSound()
  }

  watch(
    tasks,
    (list) => {
      const notificationsEnabled = resolveNotificationsEnabled(settings.value)
      const notifyHitl = resolveNotifyHitlPending(settings.value)
      const notifyQa = resolveNotifyQaReady(settings.value)
      const nextFlags = new Map<string, { hitl: boolean; qa: boolean }>()
      for (const task of list || []) {
        const taskId = task.task_id
        if (!taskId) continue
        const hitl = Boolean(task.hitl_pending)
        const qa = Boolean(task.has_qa)
        nextFlags.set(taskId, { hitl, qa })
        const prev = prevFlags.get(taskId)
        if (hitl && !prev?.hitl && notificationsEnabled && notifyHitl) {
          pushEvent(taskId, 'hitl_pending', typeof task.hitl_pending === 'string' ? task.hitl_pending : null)
        }
        if (qa && !prev?.qa && notificationsEnabled && notifyQa) {
          pushEvent(taskId, 'qa_ready', null)
        }
      }
      prevFlags = nextFlags
    },
    { immediate: true },
  )

  const unreadCount = computed(() => history.value.filter((e) => !e.read).length)

  function markRead(id: string) {
    const idx = history.value.findIndex((e) => e.id === id)
    if (idx !== -1 && !history.value[idx].read) {
      history.value = history.value.map((e) => (e.id === id ? { ...e, read: true } : e))
    }
    if (!readIds.has(id)) {
      readIds.add(id)
      saveReadIds(readIds)
    }
  }

  function markAllRead() {
    history.value = history.value.map((e) => (e.read ? e : { ...e, read: true }))
    for (const e of history.value) readIds.add(e.id)
    saveReadIds(readIds)
  }

  return { history, unreadCount, markRead, markAllRead }
}
