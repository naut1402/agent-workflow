import { computed, ref } from 'vue'
import { fetchTaskChat, sendTaskFeedback } from '../../monitor/scripts/monitorApi'

/**
 * Chat with the runner of a task's pipeline step: replays the CLI session's own
 * conversation history (`GET /api/tasks/:id/chat`) and keeps polling it, so a
 * step that is still running streams its progress instead of going silent until
 * it finishes. Sending posts to `/api/tasks/:id/feedback`, which resumes that
 * exact session.
 */

export type TaskChatTurnRole = 'user' | 'assistant' | 'tool'

export interface TaskChatTurn {
  index: number
  role: TaskChatTurnRole
  text: string
  at?: string
  tool?: string
}

export type TaskChatBlockedReason = 'stepRunning' | 'noCompletedJob' | 'noSession'

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
  stepRunning: 'Step đang chạy — chờ chạy xong mới gửi được tin nhắn.',
  noCompletedJob: 'Chưa có job nào hoàn tất cho task này để nối tiếp hội thoại.',
  noSession: 'Không còn phiên CLI nào mở cho task này để nối tiếp.',
}

export function useTaskChat(opts: UseTaskChatOptions) {
  const turns = ref<TaskChatTurn[]>([])
  const total = ref(0)
  const sessionId = ref<string | null>(null)
  const transcriptFound = ref(false)
  const running = ref<{ jobId: string; stepId?: string } | null>(null)
  const runner = ref<TaskChatRunner | null>(null)
  const canSend = ref(false)
  const blockedReason = ref<TaskChatBlockedReason | null>(null)
  const staleReason = ref<string | null>(null)
  const sending = ref(false)
  /** Messages posted but not yet visible in the transcript (optimistic echo). */
  const pending = ref<string[]>([])
  const error = ref<string | null>(null)
  const loading = ref(false)

  const runningPollMs = opts.runningPollMs ?? 2000
  const idlePollMs = opts.idlePollMs ?? 6000

  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const blockedText = computed(() => (blockedReason.value ? BLOCKED_TEXT[blockedReason.value] : null))

  function applyState(data: any, incremental: boolean): void {
    const fresh: TaskChatTurn[] = Array.isArray(data?.turns) ? data.turns : []
    // Anything the CLI has now recorded supersedes our optimistic echo.
    if (fresh.length > 0) pending.value = []
    if (incremental) {
      // `from` was honoured: append only turns we have not seen.
      const seen = new Set(turns.value.map((t) => t.index))
      for (const t of fresh) if (!seen.has(t.index)) turns.value.push(t)
    } else {
      turns.value = fresh
    }
    total.value = typeof data?.total === 'number' ? data.total : turns.value.length
    sessionId.value = data?.sessionId ?? null
    transcriptFound.value = Boolean(data?.transcriptFound)
    running.value = data?.running ?? null
    runner.value = data?.runner ?? null
    canSend.value = Boolean(data?.canSend)
    blockedReason.value = data?.blockedReason ?? null
    staleReason.value = data?.staleReason ?? null
  }

  async function refresh(incremental = true): Promise<void> {
    const taskId = opts.getTaskId()
    if (!taskId) return
    if (!incremental) {
      turns.value = []
      total.value = 0
      pending.value = []
    }
    loading.value = turns.value.length === 0
    try {
      const data = await fetchTaskChat(
        taskId,
        { stepId: opts.getStepId(), from: incremental ? total.value : 0 },
        opts.getProjectId(),
      )
      applyState(data, incremental)
      error.value = null
    } catch (e: any) {
      error.value = String(e?.message || e)
    } finally {
      loading.value = false
    }
  }

  function scheduleNext(): void {
    if (stopped) return
    timer = setTimeout(async () => {
      await refresh(true)
      scheduleNext()
    }, running.value ? runningPollMs : idlePollMs)
  }

  async function start(): Promise<void> {
    stopped = false
    await refresh(false)
    scheduleNext()
  }

  function stop(): void {
    stopped = true
    if (timer) clearTimeout(timer)
    timer = null
  }

  async function send(text: string): Promise<void> {
    const message = text.trim()
    if (!message || sending.value) return
    sending.value = true
    error.value = null
    try {
      await sendTaskFeedback(opts.getTaskId(), message, { stepId: opts.getStepId() }, opts.getProjectId())
      // The message only becomes a transcript turn once the CLI records it —
      // echo it meanwhile so the input never looks lost.
      pending.value.push(message)
      await refresh(true)
    } catch (e: any) {
      error.value =
        e?.status === 409
          ? BLOCKED_TEXT.stepRunning
          : String(e?.message || e)
    } finally {
      sending.value = false
    }
  }

  return {
    turns,
    pending,
    total,
    sessionId,
    transcriptFound,
    running,
    runner,
    canSend,
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
