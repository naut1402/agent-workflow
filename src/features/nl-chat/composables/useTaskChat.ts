import { computed, ref } from 'vue'
import { fetchTaskChat, sendTaskFeedback } from '../../monitor/scripts/monitorApi'
import { resolveChatFeedbackMode } from '../../../core/configs/appSettings'
import { useAppSettings } from '../../../core/composables/useAppSettings'

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

/** A step's own job is busy and this session has no `.dev-state` to queue against (nl-chat). */
const STEP_BUSY_TEXT = 'Step đang chạy — chờ chạy xong mới gửi được tin nhắn.'
/** Shown while the target step's job is running, in the (default) queue mode — before anything has been sent. */
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
  /** A message sent right now would be queued rather than sent immediately. */
  const queued = ref(false)
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

  const blockedText = computed(() => {
    if (blockedReason.value) return BLOCKED_TEXT[blockedReason.value]
    if (queued.value) return QUEUED_TEXT
    return null
  })

  /** Drop optimistic echoes once the server history contains them (or a reply). */
  function reconcilePending(allTurns: TaskChatTurn[], data: any): void {
    if (pending.value.length === 0) return
    const userTexts = new Set(
      allTurns.filter((t) => t.role === 'user').map((t) => t.text.trim()),
    )
    pending.value = pending.value.filter((p) => !userTexts.has(p.trim()))
    // Job finished and we have an assistant turn — echo is obsolete even if the
    // user line was clipped differently than the optimistic text.
    if (!data?.running && allTurns.some((t) => t.role === 'assistant') && pending.value.length) {
      pending.value = []
    }
  }

  function applyState(data: any, incremental: boolean): void {
    const fresh: TaskChatTurn[] = Array.isArray(data?.turns) ? data.turns : []
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
    transcriptMissingReason.value = data?.transcriptMissingReason ?? null
    running.value = data?.running ?? null
    runner.value = data?.runner ?? null
    canSend.value = Boolean(data?.canSend)
    queued.value = Boolean(data?.queued)
    blockedReason.value = data?.blockedReason ?? null
    staleReason.value = data?.staleReason ?? null
    reconcilePending(turns.value, data)
  }

  async function refresh(incremental = true): Promise<void> {
    const taskId = opts.getTaskId()
    if (!taskId) return
    // While an optimistic send is waiting, always reload from 0. Job-fallback
    // turns use a 0-based index space that resets per response shape; polling
    // with from=<old total> returns [] forever and leaves "Đang gửi" stuck.
    const useIncremental = incremental && pending.value.length === 0
    if (!useIncremental && !incremental) {
      turns.value = []
      total.value = 0
      pending.value = []
    } else if (!useIncremental) {
      // Keep pending; replace turns from a full snapshot.
      turns.value = []
      total.value = 0
    }
    loading.value = turns.value.length === 0 && pending.value.length === 0
    try {
      const data = await fetchTaskChat(
        taskId,
        { stepId: opts.getStepId(), from: useIncremental ? total.value : 0 },
        opts.getProjectId(),
      )
      applyState(data, useIncremental)
      error.value = null
    } catch (e: any) {
      error.value = String(e?.message || e)
    } finally {
      loading.value = false
    }
  }

  function scheduleNext(): void {
    if (stopped) return
    // Poll fast while a send is in flight or a job is running.
    const delay = running.value || pending.value.length ? runningPollMs : idlePollMs
    timer = setTimeout(async () => {
      await refresh(true)
      scheduleNext()
    }, delay)
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
      const mode = resolveChatFeedbackMode(settings.value)
      await sendTaskFeedback(opts.getTaskId(), message, { stepId: opts.getStepId(), mode }, opts.getProjectId())
      // The message only becomes a transcript turn once the CLI records it (or,
      // if queued, once the running job finishes and it resubmits) — echo it
      // meanwhile so the input never looks lost. Full refresh (pending≠∅) so we
      // do not poll with a stale `from` against job-fallback indices.
      pending.value.push(message)
      await refresh(true)
    } catch (e: any) {
      error.value = e?.status === 409 ? STEP_BUSY_TEXT : String(e?.message || e)
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
