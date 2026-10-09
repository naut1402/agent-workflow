import { computed, ref } from 'vue'
import { fetchTaskChat, sendTaskFeedback } from '../../monitor/scripts/monitorApi'
import { resolveChatFeedbackMode } from '../../../frontend/configs/appSettings'
import { useAppSettings } from '../../../frontend/composables/useAppSettings'
import { openSseStream, type SseStream } from '../../../frontend/lib/sseClient'
import { ensureDashboardTransport, isSseEnabled } from '../../../frontend/lib/dashboardTransport'

export type TaskChatTurnRole = 'user' | 'assistant' | 'tool'

export interface TaskChatTurn {
  index: number
  role: TaskChatTurnRole
  text: string
  at?: string
  tool?: string
}

/** `sortedTurns` entry merged with an in-flight optimistic echo, in send order. */
export interface TaskChatTimelineItem extends TaskChatTurn {
  pending?: boolean
}

export type TaskChatBlockedReason = 'noCompletedJob'

export interface TaskChatRunner {
  id: string
  name: string
  enabled: boolean
}

export interface UseTaskChatOptions {
  getTaskId: () => string
  getStepId: () => string | undefined
  getProjectId: () => string | undefined
  /** Poll interval while a step is running. */
  runningPollMs?: number
  /** Poll interval when nothing is running. */
  idlePollMs?: number
}

const BLOCKED_TEXT: Record<TaskChatBlockedReason, string> = {
  noCompletedJob: 'Chưa có job nào hoàn tất cho task này để nối tiếp hội thoại.',
}

const STEP_BUSY_TEXT = 'Step đang chạy — chờ chạy xong mới gửi được tin nhắn.'
const QUEUED_TEXT = 'Tin nhắn mới sẽ được gửi khi step hiện tại hoàn tất.'

export function useTaskChat(opts: UseTaskChatOptions) {
  const { settings } = useAppSettings()
  const turns = ref<TaskChatTurn[]>([])
  const total = ref(0)
  const sessionId = ref<string | null>(null)
  const transcriptFound = ref(false)
  const transcriptMissingReason = ref<string | null>(null)
  const running = ref<{ jobId: string; stepId?: string } | null>(null)
  const runner = ref<TaskChatRunner | null>(null)
  const canSend = ref(false)
  const queued = ref(false)
  const blockedReason = ref<TaskChatBlockedReason | null>(null)
  const staleReason = ref<string | null>(null)
  const sending = ref(false)
  const pendingItems = ref<{ text: string; at: string }[]>([])
  const pending = computed(() => pendingItems.value.map((p) => p.text))
  const error = ref<string | null>(null)
  const loading = ref(false)

  const runningPollMs = opts.runningPollMs ?? 2000
  const idlePollMs = opts.idlePollMs ?? 6000

  let timer: ReturnType<typeof setTimeout> | null = null
  let stream: SseStream | null = null
  let stopped = false
  // xem docs/architecture/code/nl-chat.md §8
  let generation = 0

  const blockedText = computed(() => {
    if (blockedReason.value) return BLOCKED_TEXT[blockedReason.value]
    if (queued.value) return QUEUED_TEXT
    return null
  })

  // xem docs/architecture/code/nl-chat.md §8
  const sortedTurns = computed<TaskChatTurn[]>(() => {
    const list = turns.value
    const allHaveAt = list.length > 0 && list.every((t) => t.at && !Number.isNaN(Date.parse(t.at)))
    if (!allHaveAt) return list
    return [...list].sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!) || a.index - b.index)
  })

  const timeline = computed<TaskChatTimelineItem[]>(() => {
    const base: TaskChatTimelineItem[] = sortedTurns.value
    if (pendingItems.value.length === 0) return base
    const pendingTurns: TaskChatTimelineItem[] = pendingItems.value.map((p, i) => ({
      index: -1 - i,
      role: 'user',
      text: p.text,
      at: p.at,
      pending: true,
    }))
    const merged = [...base, ...pendingTurns]
    const allHaveAt = merged.every((t) => t.at && !Number.isNaN(Date.parse(t.at)))
    if (!allHaveAt) return merged
    return [...merged].sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!) || a.index - b.index)
  })

  function reconcilePending(allTurns: TaskChatTurn[], data: any): void {
    if (pendingItems.value.length === 0) return
    const userTexts = new Set(
      allTurns.filter((t) => t.role === 'user').map((t) => t.text.trim()),
    )
    pendingItems.value = pendingItems.value.filter((p) => !userTexts.has(p.text.trim()))
    if (!data?.running && allTurns.some((t) => t.role === 'assistant') && pendingItems.value.length) {
      pendingItems.value = []
    }
  }

  function applyState(data: any, incremental: boolean): void {
    const fresh: TaskChatTurn[] = Array.isArray(data?.turns) ? data.turns : []
    if (incremental) {
      const seen = new Set(turns.value.map((t) => t.index))
      for (const t of fresh) if (!seen.has(t.index)) turns.value.push(t)
    } else {
      turns.value = fresh
    }
    total.value = typeof data?.total === 'number' ? data.total : turns.value.length
    sessionId.value = data?.sessionId ?? null
    transcriptFound.value = Boolean(data?.transcriptFound)
    transcriptMissingReason.value = data?.transcriptMissingReason ?? null
    running.value = data?.running ?? null
    runner.value = data?.runner ?? null
    canSend.value = Boolean(data?.canSend)
    queued.value = Boolean(data?.queued)
    blockedReason.value = data?.blockedReason ?? null
    staleReason.value = data?.staleReason ?? null
    reconcilePending(turns.value, data)
  }

  // xem docs/architecture/code/nl-chat.md §8
  function prepareFetchWindow(incremental: boolean): boolean {
    const useIncremental = incremental && pendingItems.value.length === 0
    if (!useIncremental) {
      turns.value = []
      total.value = 0
      if (!incremental) pendingItems.value = []
    }
    loading.value = turns.value.length === 0 && pendingItems.value.length === 0
    return useIncremental
  }

  async function refresh(incremental = true, gen: number = generation): Promise<void> {
    const taskId = opts.getTaskId()
    if (!taskId) return
    const useIncremental = prepareFetchWindow(incremental)
    try {
      const data = await fetchTaskChat(
        taskId,
        { stepId: opts.getStepId(), from: useIncremental ? total.value : 0 },
        opts.getProjectId(),
      )
      if (gen !== generation) return
      applyState(data, useIncremental)
      error.value = null
    } catch (e: any) {
      if (gen !== generation) return
      error.value = String(e?.message || e)
    } finally {
      if (gen === generation) loading.value = false
    }
  }

  function scheduleNext(gen: number): void {
    if (stopped || gen !== generation) return
    const delay = running.value || pendingItems.value.length ? runningPollMs : idlePollMs
    timer = setTimeout(async () => {
      if (gen !== generation) return
      await refresh(true, gen)
      scheduleNext(gen)
    }, delay)
  }

  function startSse(gen: number): void {
    const taskId = opts.getTaskId()
    if (!taskId) return
    prepareFetchWindow(false)
    let firstPush = true
    stream = openSseStream(
      `/api/tasks/${encodeURIComponent(taskId)}/chat/stream`,
      { project: opts.getProjectId(), stepId: opts.getStepId() },
      {
        onEvent: (type, data) => {
          if (gen !== generation || type !== 'chat') return
          applyState(data, !firstPush)
          firstPush = false
          error.value = null
          loading.value = false
        },
        onError: (e: any) => {
          if (gen !== generation) return
          error.value = String(e?.message || e)
        },
      },
    )
  }

  async function start(): Promise<void> {
    // xem docs/architecture/code/nl-chat.md §8
    stop()
    const gen = ++generation
    stopped = false
    const transport = await ensureDashboardTransport()
    if (gen !== generation) return
    if (isSseEnabled(transport)) {
      startSse(gen)
      return
    }
    await refresh(false, gen)
    if (gen !== generation) return
    scheduleNext(gen)
  }

  function stop(): void {
    stopped = true
    generation++
    if (timer) clearTimeout(timer)
    timer = null
    stream?.close()
    stream = null
    loading.value = false
  }

  async function send(text: string): Promise<void> {
    const message = text.trim()
    if (!message || sending.value) return
    sending.value = true
    error.value = null
    try {
      const mode = resolveChatFeedbackMode(settings.value)
      await sendTaskFeedback(opts.getTaskId(), message, { stepId: opts.getStepId(), mode }, opts.getProjectId())
      pendingItems.value.push({ text: message, at: new Date().toISOString() })
      await refresh(true)
    } catch (e: any) {
      error.value = e?.status === 409 ? STEP_BUSY_TEXT : String(e?.message || e)
    } finally {
      sending.value = false
    }
  }

  return {
    turns,
    sortedTurns,
    timeline,
    pending,
    total,
    sessionId,
    transcriptFound,
    transcriptMissingReason,
    running,
    runner,
    canSend,
    queued,
    blockedReason,
    blockedText,
    staleReason,
    sending,
    loading,
    error,
    start,
    stop,
    refresh,
    send,
  }
}
