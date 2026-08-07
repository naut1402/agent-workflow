import {
  getConnection,
  getRunner,
  listJobs,
  loadTaskSessionLedger,
  parseCursorJsonOutput,
  stepIdOf,
} from './index.js'
import type { JobRecord, SessionEntry } from './index.js'
import { readTextFileSync } from '../../../core/lib/fileHelper.js'
import { readSessionTranscript, type TranscriptTurn } from './sessionTranscript.js'
import { readCursorSessionTranscript } from './cursorSessionTranscript.js'

const RESPONSE_HEADER = '=== Phản hồi của runner (stdout/stderr) ==='
const RESULT_HEADER = '=== Kết quả ==='
const MAX_FALLBACK_CHARS = 4000

function clipFallback(text: string): string {
  const t = text.trim()
  return t.length > MAX_FALLBACK_CHARS ? `${t.slice(0, MAX_FALLBACK_CHARS)}\n…(đã cắt bớt)` : t
}

/**
 * Agent reply for a finished job when the CLI transcript file is missing.
 * Prefer persisted `job.stdout` (NL chat / agent-cli); else strip framing from
 * the job log — same approach as nl-chat's `agentStdoutOf`.
 */
function agentOutputFromJob(job: JobRecord): string {
  if (typeof job.stdout === 'string' && job.stdout.trim()) {
    return extractAgentText(job.stdout)
  }

  let log = ''
  try {
    log = job.logPath ? readTextFileSync(job.logPath) : ''
  } catch {
    return ''
  }

  const start = log.indexOf(RESPONSE_HEADER)
  if (start < 0) return ''
  let body = log.slice(start + RESPONSE_HEADER.length)
  const end = body.indexOf(RESULT_HEADER)
  if (end >= 0) body = body.slice(0, end)
  const stripped = body
    .split('\n')
    .filter((line) => !line.startsWith('[runner] '))
    .join('\n')
    .trim()
  return extractAgentText(stripped)
}

/** Prefer Cursor/agent JSON `result` field when stdout is still raw JSON. */
function extractAgentText(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const parsed = parseCursorJsonOutput(trimmed)
  if (typeof parsed.result === 'string' && parsed.result.trim()) return parsed.result.trim()
  return trimmed
}

/** Build user/assistant turns from a job when disk transcript is unavailable. */
function synthesizeTurnsFromJob(job: JobRecord): TranscriptTurn[] {
  const turns: TranscriptTurn[] = []
  const prompt = typeof job.userPrompt === 'string' ? job.userPrompt.trim() : ''
  if (prompt) {
    turns.push({ index: 0, role: 'user', text: clipFallback(prompt) })
  }
  const out = agentOutputFromJob(job)
  if (out) {
    turns.push({
      index: turns.length,
      role: 'assistant',
      text: clipFallback(out),
      at: job.finishedAt || job.startedAt || undefined,
    })
  }
  return turns
}

/**
 * State for "chat trực tiếp với runner": the conversation history of the CLI
 * session a pipeline step ran under, plus whether a message can be sent right
 * now. History comes from the CLI's own session transcript
 * (`sessionTranscript.ts` / `cursorSessionTranscript.ts`), which the CLI
 * appends to while it works — so the same endpoint doubles as live monitoring
 * of a running step instead of only showing the result once it finishes.
 *
 * Sending itself stays `sendTaskFeedback()` (F0011); this module only mirrors
 * its guards so the UI can explain *why* the input is blocked before the user
 * types, instead of surfacing a 400/409 after the fact.
 */

export type TaskChatBlockedReason = 'noCompletedJob'

export type TranscriptProviderHint = 'claude-code-cli' | 'cursor-cli' | 'unknown'

export interface TaskChatRunningJob {
  jobId: string
  stepId?: string
  startedAt: string | null
}

/** Runner behind this chat, so the UI can name it (and say if it is disabled). */
export interface TaskChatRunner {
  id: string
  name: string
  enabled: boolean
}

export interface TaskChatState {
  taskId: string
  /** The step this view is scoped to, when opened from a pipeline node. */
  stepId?: string
  /** CLI session whose transcript is being shown (null = nothing to show yet). */
  sessionId: string | null
  /** True when the transcript file was found on disk. */
  transcriptFound: boolean
  /**
   * When sessionId is set but the transcript file is missing — UI should show
   * a clear message instead of an empty/erroring chat.
   */
  transcriptMissingReason?: string
  /** Which transcript backend was used. */
  transcriptProvider?: TranscriptProviderHint
  turns: TranscriptTurn[]
  /** Total turns in the transcript — pass back as `fromIndex` to poll. */
  total: number
  running: TaskChatRunningJob | null
  runner: TaskChatRunner | null
  canSend: boolean
  /** A message sent now would be queued (step running) rather than sent right away. */
  queued: boolean
  blockedReason?: TaskChatBlockedReason
  /** Set when the ledger entry we would resume is no longer usable. */
  staleReason?: string
}

function jobsOfTask(taskId: string): JobRecord[] {
  return listJobs(200)
    .filter((j) => j.metadata?.taskId === taskId && !j.applyTarget)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
}

function providerIdOfJob(job: JobRecord | undefined): string | null {
  if (!job) return null
  const runner = getRunner(job.runnerId)
  if (!runner) return null
  const conn = getConnection(runner.connectionId)
  return conn?.providerId || null
}

function resolveTranscriptProvider(
  providerId: string | null | undefined,
  entry?: SessionEntry,
): TranscriptProviderHint {
  const id = providerId || entry?.providerId || ''
  if (id === 'cursor-cli') return 'cursor-cli'
  if (id === 'claude-code-cli') return 'claude-code-cli'
  if (id === 'codex-cli') return 'unknown'
  return id ? 'unknown' : 'claude-code-cli'
}

function readTranscriptForProvider(
  hint: TranscriptProviderHint,
  sessionId: string,
  workspace: string | undefined,
  opts: { fromIndex?: number; includeToolActivity?: boolean },
): { turns: TranscriptTurn[]; total: number; file: string | null; matchedProvider: TranscriptProviderHint } {
  if (hint === 'cursor-cli') {
    const r = readCursorSessionTranscript(sessionId, workspace, opts)
    return { ...r, matchedProvider: 'cursor-cli' }
  }
  // Claude (default) + unknown → try Claude path first, then Cursor fallback
  const claude = readSessionTranscript(sessionId, workspace, opts)
  if (claude.file) return { ...claude, matchedProvider: 'claude-code-cli' }
  const cursor = readCursorSessionTranscript(sessionId, workspace, opts)
  if (cursor.file) return { ...cursor, matchedProvider: 'cursor-cli' }
  return { ...claude, matchedProvider: hint }
}

/**
 * The CLI session to show for (task, step). A running job wins — its session is
 * the one producing output right now — then the newest finished job of that
 * step, then the step's ledger entry, then the task's newest open entry.
 */
export function resolveChatSession(
  projectId: string,
  taskId: string,
  stepId?: string,
): {
  sessionId: string | null
  workspace?: string
  entry?: SessionEntry
  staleReason?: string
  providerId?: string | null
  job?: JobRecord
} {
  const jobs = jobsOfTask(taskId)
  const running = jobs.find((j) => j.status === 'queued' || j.status === 'running')
  if (running?.sessionId && (!stepId || stepIdOf(running) === stepId || !stepIdOf(running))) {
    return {
      sessionId: running.sessionId,
      workspace: running.workspace,
      providerId: providerIdOfJob(running),
      job: running,
    }
  }

  if (stepId) {
    const ofStep = jobs.find((j) => stepIdOf(j) === stepId && j.sessionId)
    if (ofStep?.sessionId) {
      return {
        sessionId: ofStep.sessionId,
        workspace: ofStep.workspace,
        providerId: providerIdOfJob(ofStep),
        job: ofStep,
      }
    }
  }

  const ledger = loadTaskSessionLedger(projectId, taskId)
  const byStep = stepId
    ? [...ledger.sessions].reverse().find((s) => s.stepIds?.includes(stepId) && s.sessionId)
    : undefined
  const open = [...ledger.sessions].reverse().find((s) => s.status === 'open' && s.sessionId)
  const entry = byStep ?? open ?? [...ledger.sessions].reverse().find((s) => s.sessionId)
  if (entry) {
    return {
      sessionId: entry.sessionId,
      workspace: entry.workspace,
      entry,
      providerId: entry.providerId,
      staleReason:
        entry.status === 'stale' || entry.status === 'archived'
          ? entry.staleReason || entry.status
          : undefined,
    }
  }

  const anyJob = jobs.find((j) => j.sessionId)
  return anyJob?.sessionId
    ? {
        sessionId: anyJob.sessionId,
        workspace: anyJob.workspace,
        providerId: providerIdOfJob(anyJob),
        job: anyJob,
      }
    : { sessionId: null }
}

export interface GetTaskChatStateOptions {
  stepId?: string
  /** Only return turns at/after this index (poll cursor). */
  fromIndex?: number
  includeToolActivity?: boolean
}

export function getTaskChatState(
  projectId: string,
  taskId: string,
  opts: GetTaskChatStateOptions = {},
): TaskChatState {
  const jobs = jobsOfTask(taskId)
  const runningJob = jobs.find((j) => j.status === 'queued' || j.status === 'running')
  const hasFinished = jobs.some((j) => j.status === 'succeeded' || j.status === 'failed')

  let blockedReason: TaskChatBlockedReason | undefined
  if (!runningJob && !hasFinished) blockedReason = 'noCompletedJob'

  const resolved = resolveChatSession(projectId, taskId, opts.stepId)
  const hint = resolveTranscriptProvider(resolved.providerId, resolved.entry)
  const transcript = resolved.sessionId
    ? readTranscriptForProvider(hint, resolved.sessionId, resolved.workspace, {
        fromIndex: opts.fromIndex,
        includeToolActivity: opts.includeToolActivity,
      })
    : { turns: [], total: 0, file: null, matchedProvider: hint as TranscriptProviderHint }

  const runnerJob =
    runningJob ??
    (opts.stepId
      ? jobs.find((j) => stepIdOf(j) === opts.stepId && (j.status === 'succeeded' || j.status === 'failed'))
      : undefined) ??
    resolved.job ??
    jobs.find((j) => j.status === 'succeeded' || j.status === 'failed') ??
    jobs[0]
  const runnerConfig = runnerJob ? getRunner(runnerJob.runnerId) : null

  // Cursor/agent-cli often leave no on-disk transcript the dashboard can find,
  // while the job log / stdout already holds the reply. Fall back so chat is
  // not empty after a successful run.
  let turns = transcript.turns
  let total = transcript.total
  let transcriptFound = Boolean(transcript.file)
  let transcriptMissingReason: string | undefined
  const from = opts.fromIndex ?? 0
  if ((!transcript.file || turns.length === 0) && runnerJob && !runningJob) {
    const synthesized = synthesizeTurnsFromJob(runnerJob)
    if (synthesized.length) {
      turns = synthesized.filter((t) => t.index >= from)
      total = synthesized.length
      transcriptFound = true
    }
  }

  if (resolved.sessionId && !transcriptFound) {
    if (transcript.matchedProvider === 'cursor-cli' || hint === 'cursor-cli') {
      transcriptMissingReason =
        'Không tìm thấy transcript Cursor cho session này (kiểm tra ~/.cursor/projects/*/agent-transcripts). Có thể CLI chưa ghi file hoặc session_id chưa capture.'
    } else {
      transcriptMissingReason =
        'Không tìm thấy transcript trên disk cho session id này. Session có thể thuộc provider khác hoặc cwd không khớp.'
    }
  }

  return {
    taskId,
    stepId: opts.stepId,
    sessionId: resolved.sessionId,
    transcriptFound,
    ...(transcriptMissingReason ? { transcriptMissingReason } : {}),
    transcriptProvider: transcript.matchedProvider,
    turns,
    total,
    running: runningJob
      ? { jobId: runningJob.id, stepId: stepIdOf(runningJob), startedAt: runningJob.startedAt }
      : null,
    runner: runnerConfig
      ? { id: runnerConfig.id, name: runnerConfig.name || runnerConfig.id, enabled: runnerConfig.enabled !== false }
      : runnerJob
        ? { id: runnerJob.runnerId, name: runnerJob.runnerId, enabled: false }
        : null,
    canSend: !blockedReason,
    queued: Boolean(runningJob),
    ...(blockedReason ? { blockedReason } : {}),
    ...(resolved.staleReason ? { staleReason: resolved.staleReason } : {}),
  }
}
