import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useNotifications } from '@/features/notifications/composables/useNotifications'

function makeStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => store.clear(),
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useNotifications', () => {
  it('notifies only on the false→true transition, not on repeated polls', async () => {
    const tasks = ref<any[]>([{ task_id: 't1', hitl_pending: false, has_qa: false }])
    const { history, toasts } = useNotifications(tasks)

    tasks.value = [{ task_id: 't1', hitl_pending: 'implement', has_qa: false }]
    await nextTick()
    expect(history.value).toHaveLength(1)
    expect(toasts.value).toHaveLength(1)
    expect(history.value[0]).toMatchObject({ id: 't1:hitl_pending', taskId: 't1', kind: 'hitl_pending', detail: 'implement', read: false })

    // Same flag still true on the next poll tick — must not re-notify.
    tasks.value = [{ task_id: 't1', hitl_pending: 'implement', has_qa: false }]
    await nextTick()
    expect(history.value).toHaveLength(1)
  })

  it('dedupes by taskId:kind and tracks hitl_pending / qa_ready independently', async () => {
    const tasks = ref<any[]>([{ task_id: 't1', hitl_pending: false, has_qa: false }])
    const { history } = useNotifications(tasks)

    tasks.value = [{ task_id: 't1', hitl_pending: 'review', has_qa: false }]
    await nextTick()
    tasks.value = [{ task_id: 't1', hitl_pending: 'review', has_qa: true }]
    await nextTick()

    expect(history.value.map((e) => e.id).sort()).toEqual(['t1:hitl_pending', 't1:qa_ready'])
  })

  it('markRead / markAllRead update unreadCount and clear matching toasts', async () => {
    const tasks = ref<any[]>([{ task_id: 't1', hitl_pending: false, has_qa: false }])
    const { history, toasts, unreadCount, markRead, markAllRead } = useNotifications(tasks)

    tasks.value = [{ task_id: 't1', hitl_pending: 'implement', has_qa: true }]
    await nextTick()
    expect(unreadCount.value).toBe(2)

    markRead('t1:hitl_pending')
    expect(unreadCount.value).toBe(1)
    expect(toasts.value.find((t) => t.id === 't1:hitl_pending')).toBeUndefined()

    markAllRead()
    expect(unreadCount.value).toBe(0)
    expect(toasts.value).toHaveLength(0)
  })

  it('caps history length at 50', async () => {
    const tasks = ref<any[]>([])
    const { history } = useNotifications(tasks)

    const many = Array.from({ length: 60 }, (_, i) => ({ task_id: `t${i}`, hitl_pending: 'x', has_qa: false }))
    tasks.value = many
    await nextTick()

    expect(history.value.length).toBe(50)
  })

  it('persists read state to localStorage and restores it across instances', async () => {
    const tasks = ref<any[]>([{ task_id: 't1', hitl_pending: 'implement', has_qa: false }])
    const first = useNotifications(tasks)
    await nextTick()
    first.markRead('t1:hitl_pending')

    // Fresh composable instance simulating a page reload; same flag is still
    // true, but since it flips from "no prior task" (undefined) → true again,
    // it fires once more — this time it must come back pre-marked as read.
    const tasksAgain = ref<any[]>([{ task_id: 't1', hitl_pending: 'implement', has_qa: false }])
    const second = useNotifications(tasksAgain)
    await nextTick()

    expect(second.history.value[0]).toMatchObject({ id: 't1:hitl_pending', read: true })
    expect(second.toasts.value).toHaveLength(0)
    expect(second.unreadCount.value).toBe(0)
  })
})
