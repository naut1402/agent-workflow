import {
  getConnection,
  getRunner,
  listJobs,
  loadTaskSessionLedger,
  parseCursorJsonOutput,
  providerFamilyOf,
  stepIdOf,
} from './index.js'
import type { JobRecord, SessionEntry, TaskSessionLedger } from './index.js'
import { readTextFileSync } from '../../../core/lib/fileHelper.js'
import { readSessionTranscript, type TranscriptTurn } from './sessionTranscript.js'
import { readCursorSessionTranscript, stripCursorUserWrapper } from './cursorSessionTranscript.js'
import { readApiAgentTranscript } from './apiAgentTranscript.js'

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
    return stripCursorUserWrapper(extractAgentText(job.stdout))
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
  return stripCursorUserWrapper(extractAgentText(stripped))
}

/** Prefer Cursor/agent JSON `result` field when stdout is still raw JSON. */
function extractAgentText(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const parsed = parseCursorJsonOutput(trimmed)
  if (typeof parsed.result === 'string' && parsed.result.trim()) return parsed.result.trim()
  return trimmed
}

/** Build user/assistant turns from a single finished job (indices start at `startIndex`). */
function synthesizeTurnsFromJob(job: JobRecord, startIndex = 0): TranscriptTurn[] {
  const turns: TranscriptTurn[] = []
  const prompt = typeof job.userPrompt === 'string' ? job.userPrompt.trim() : ''
  if (prompt) {
    turns.push({ index: startIndex + turns.length, role: 'user', text: clipFallback(prompt) })
  }
  const out = agentOutputFromJob(job)
  if (out) {
    turns.push({
      index: startIndex + turns.length,
      role: 'assistant',
      text: clipFallback(out),
      at: job.finishedAt || job.startedAt || undefined,
    })
  }
  return turns
}

/**
 * Conversation reconstructed from finished pipeline/feedback jobs when the CLI
 * transcript file is missing or empty. Jobs are oldest→newest so chat-feedback
 * rounds append after the original step run — stable indices for poll `from`.
 */
function synthesizeTurnsFromJobs(jobs: JobRecord[]): TranscriptTurn[] {
  const chronological = [...jobs].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
  const turns: TranscriptTurn[] = []
  for (const job of chronological) {
    turns.push(...synthesizeTurnsFromJob(job, turns.length))
  }
  return turns
}

function finishedJobsForChat(jobs: JobRecord[], stepId?: string, sessionId?: string | null): JobRecord[] {
  return jobs.filter((j) => {
    if (j.status !== 'succeeded' && j.status !== 'failed') return false
    if (stepId && stepIdOf(j) !== stepId) {
      // Feedback jobs keep parent step id; also accept same CLI session.
      if (!sessionId || j.sessionId !== sessionId) return false
    }
    return true
  })
}

/** True when the latest finished job's prompt/reply is already in transcript turns. */
function transcriptCoversLatestJob(turns: TranscriptTurn[], latest: JobRecord | undefined): boolean {
  if (!latest) return true
  const prompt = typeof latest.userPrompt === 'string' ? latest.userPrompt.trim() : ''
  const out = agentOutputFromJob(latest)
  if (!prompt && !out) return true
  const texts = turns.map((t) => t.text.trim())
  if (prompt && texts.some((t) => t === clipFallback(prompt) || t.includes(prompt.slice(0, 80)))) {
    return true
  }
  if (out) {
    const clip = clipFallback(out)
    if (texts.some((t) => t === clip || t.includes(clip.slice(0, 80)))) return true
  }
  return false
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

// `providerFamilyOf(id) === 'ai-api'` (agentCli.ts) is the single source of truth for
// which provider ids are `AgenticApiProvider` subclasses — no separate id list to keep
// in sync here (any current or future `*-api` provider is picked up automatically).
export type TranscriptProviderHint = 'claude-code-cli' | 'cursor-cli' | 'unknown' | (string & {})

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
  if (providerFamilyOf(id) === 'ai-api') return id
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
  if (providerFamilyOf(hint) === 'ai-api') {
    const r = readApiAgentTranscript(hint, sessionId, opts)
    return { ...r, matchedProvider: hint }
  }
  // Claude (default) + unknown → try Claude path first, then Cursor fallback
  const claude = readSessionTranscript(sessionId, workspace, opts)
  if (claude.file) return { ...claude, matchedProvider: 'claude-code-cli' }
  const cursor = readCursorSessionTranscript(sessionId, workspace, opts)
  if (cursor.file) return { ...cursor, matchedProvider: 'cursor-cli' }
  return { ...claude, matchedProvider: hint }
}

/** True when `sessionId` was actively dismissed for `stepId` (closed/stale) with no open replacement. */
function isSessionDismissedForStep(ledger: TaskSessionLedger, sessionId: string, stepId: string): boolean {
  const openReplacement = [...ledger.sessions]
    .reverse()
    .find((s) => s.status === 'open' && s.sessionId && s.stepIds?.includes(stepId))
  if (openReplacement) return false
  return ledger.sessions.some(
    (s) => s.sessionId === sessionId && (s.status === 'closed' || s.status === 'stale'),
  )
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
  /** True when this step's session was actively dismissed (via "+") and not yet replaced. */
  dismissedForStep?: boolean
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
      const ledgerForStep = loadTaskSessionLedger(projectId, taskId)
      if (!isSessionDismissedForStep(ledgerForStep, ofStep.sessionId, stepId)) {
        return {
          sessionId: ofStep.sessionId,
          workspace: ofStep.workspace,
          providerId: providerIdOfJob(ofStep),
          job: ofStep,
        }
      }
      // Dismissed: only a fresh `open` entry for this exact step may win here —
      // do NOT fall through to the `byStep` ledger fallback below, since it does
      // not filter by status and would return the very `closed` entry just ruled out.
      const openForStep = [...ledgerForStep.sessions]
        .reverse()
        .find((s) => s.status === 'open' && s.sessionId && s.stepIds?.includes(stepId))
      return openForStep
        ? {
            sessionId: openForStep.sessionId,
            workspace: openForStep.workspace,
            entry: openForStep,
            providerId: openForStep.providerId,
          }
        : { sessionId: null, dismissedForStep: true }
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

  // Cursor/agent-cli often leave no on-disk transcript (or one that lags behind
  // chat-feedback jobs). Rebuild / extend turns from finished job stdout+logs.
  let turns = transcript.turns
  let total = transcript.total
  let transcriptFound = Boolean(transcript.file)
  let transcriptMissingReason: string | undefined
  const from = opts.fromIndex ?? 0
  const jobSource = resolved.dismissedForStep ? [] : finishedJobsForChat(jobs, opts.stepId, resolved.sessionId)
  const needJobFallback =
    !runningJob &&
    jobSource.length > 0 &&
    (!transcript.file || turns.length === 0 || !transcriptCoversLatestJob(turns, jobSource[0]))

  if (needJobFallback) {
    // When the on-disk transcript is incomplete, prefer the full job timeline
    // (includes every feedback round) over a stale partial file.
    const synthesized = synthesizeTurnsFromJobs(jobSource)
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
