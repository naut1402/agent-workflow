import { type Ref, computed, ref, watch } from 'vue'
import type { NotificationEvent, NotificationKind } from '../lib/notificationTypes'

const READ_KEY = 'dashboard.notifications.read'
const HISTORY_CAP = 50
const TOAST_TTL_MS = 6000

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

/**
 * Derives HITL-pending / QA-ready notifications from the polled `tasks` list
 * (no backend endpoint — both orchestrator- and dashboard-run tasks already
 * surface these flags through `.dev-state/<id>.json` via `/api/tasks`).
 * Only edge transitions (flag flips to true) produce a NotificationEvent, so
 * a task that stays `hitl_pending` across many poll ticks doesn't re-notify.
 */
export function useNotifications(tasks: Ref<any[]>) {
  const readIds = loadReadIds()
  const history = ref<NotificationEvent[]>([])
  const toasts = ref<NotificationEvent[]>([])
  let prevFlags = new Map<string, { hitl: boolean; qa: boolean }>()

  function dismissToast(id: string) {
    toasts.value = toasts.value.filter((e) => e.id !== id)
  }

  function pushEvent(taskId: string, kind: NotificationKind, detail: string | null) {
    const id = `${taskId}:${kind}`
    const read = readIds.has(id)
    const event: NotificationEvent = { id, taskId, kind, detail, createdAt: new Date().toISOString(), read }
    history.value = [event, ...history.value.filter((e) => e.id !== id)].slice(0, HISTORY_CAP)
    if (!read) {
      toasts.value = [...toasts.value, event]
      setTimeout(() => dismissToast(id), TOAST_TTL_MS)
    }
  }

  watch(
    tasks,
    (list) => {
      const nextFlags = new Map<string, { hitl: boolean; qa: boolean }>()
      for (const t of list || []) {
        const taskId = t.task_id
        if (!taskId) continue
        const hitl = Boolean(t.hitl_pending)
        const qa = Boolean(t.has_qa)
        nextFlags.set(taskId, { hitl, qa })
        const prev = prevFlags.get(taskId)
        if (hitl && !prev?.hitl) {
          pushEvent(taskId, 'hitl_pending', typeof t.hitl_pending === 'string' ? t.hitl_pending : null)
        }
        if (qa && !prev?.qa) {
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
    dismissToast(id)
  }

  function markAllRead() {
    history.value = history.value.map((e) => (e.read ? e : { ...e, read: true }))
    for (const e of history.value) readIds.add(e.id)
    saveReadIds(readIds)
    toasts.value = []
  }

  return { history, toasts, unreadCount, dismissToast, markRead, markAllRead }
}
