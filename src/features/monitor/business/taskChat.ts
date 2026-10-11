import { getConnection, getRunner, listJobs, loadTaskSessionLedger, stepIdOf } from './index.js'
import type { JobRecord, SessionEntry, TaskSessionLedger } from './index.js'
import { readTextFileSync } from '../../../backend/lib/fileHelper.js'
import { DECISION_SENTINEL, ORCHESTRATOR_STEP_ID } from '../../../shared/lib/orchestrator.js'
import {
  clipTurnText,
  type TranscriptProviderLabel,
  type TranscriptReadResult,
  type TranscriptTurn,
} from './transcripts/TranscriptReader.js'
import { cleanAgentReply, transcriptReaderFor } from './transcripts/transcriptReaders.js'

const RESPONSE_HEADER = '=== Phản hồi của runner (stdout/stderr) ==='
const RESULT_HEADER = '=== Kết quả ==='

function agentOutputFromJob(job: JobRecord): string {
  if (typeof job.stdout === 'string' && job.stdout.trim()) {
    return cleanAgentReply(job.stdout)
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
  return cleanAgentReply(stripped)
}

function chatTextOfJob(job: JobRecord): string {
  const text = agentOutputFromJob(job)
  return job.metadata?.orchestratorJob === true ? stripDecisionLine(text) : text
}

function isDecisionLine(line: string): boolean {
  return line.trim().replace(/^`+/, '').replace(/`+$/, '').trim().startsWith(DECISION_SENTINEL)
}

function stripDecisionLine(text: string): string {
  return text.split('\n').filter((line) => !isDecisionLine(line)).join('\n').trim()
}

function synthesizeTurnsFromJob(job: JobRecord, startIndex = 0): TranscriptTurn[] {
  const turns: TranscriptTurn[] = []
  const prompt = typeof job.userPrompt === 'string' ? job.userPrompt.trim() : ''
  if (prompt) {
    turns.push({ index: startIndex + turns.length, role: 'user', ...clipTurnText(prompt) })
  }
  const out = chatTextOfJob(job)
  if (out) {
    turns.push({
      index: startIndex + turns.length,
      role: 'assistant',
      ...clipTurnText(out),
      at: job.finishedAt || job.startedAt || undefined,
    })
  }
  return turns
}

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
      if (!sessionId || j.sessionId !== sessionId) return false
    }
    return true
  })
}

function transcriptCoversLatestJob(turns: TranscriptTurn[], latest: JobRecord | undefined): boolean {
  if (!latest) return true
  const prompt = typeof latest.userPrompt === 'string' ? latest.userPrompt.trim() : ''
  const out = chatTextOfJob(latest)
  if (!prompt && !out) return true
  const texts = turns.map((t) => t.text.trim())
  if (prompt && texts.some((t) => t === clipTurnText(prompt).text || t.includes(prompt.slice(0, 80)))) {
    return true
  }
  if (out) {
    const clip = clipTurnText(out).text
    if (texts.some((t) => t === clip || t.includes(clip.slice(0, 80)))) return true
  }
  return false
}

export type TaskChatBlockedReason = 'noCompletedJob'

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
  /** Set when sessionId is set but the transcript file is missing. */
  transcriptMissingReason?: string
  /** Which transcript backend was used. */
  transcriptProvider?: TranscriptProviderLabel
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

function isSessionDismissedForStep(ledger: TaskSessionLedger, sessionId: string, stepId: string): boolean {
  const openReplacement = [...ledger.sessions]
    .reverse()
    .find((s) => s.status === 'open' && s.sessionId && s.stepIds?.includes(stepId))
  if (openReplacement) return false
  return ledger.sessions.some((s) => s.sessionId === sessionId && s.status === 'closed')
}

function isOrchestratorEntry(entry: SessionEntry): boolean {
  return Boolean(entry.stepIds?.includes(ORCHESTRATOR_STEP_ID))
}

function isOrchestratorJobRecord(job: JobRecord): boolean {
  return job.metadata?.orchestratorJob === true || stepIdOf(job) === ORCHESTRATOR_STEP_ID
}

/**
 * The CLI session to show for (task, step).
 * xem docs/architecture/code/monitor.md §3
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

  if (stepId === ORCHESTRATOR_STEP_ID) {
    const own = jobs.find((j) => j.metadata?.orchestratorJob === true && j.sessionId)
    if (own?.sessionId) {
      return {
        sessionId: own.sessionId,
        workspace: own.workspace,
        providerId: providerIdOfJob(own),
        job: own,
      }
    }
    const ownEntry = [...loadTaskSessionLedger(projectId, taskId).sessions]
      .reverse()
      .find((s) => s.sessionId && s.stepIds?.includes(ORCHESTRATOR_STEP_ID))
    return ownEntry
      ? {
          sessionId: ownEntry.sessionId,
          workspace: ownEntry.workspace,
          entry: ownEntry,
          providerId: ownEntry.providerId,
        }
      : { sessionId: null }
  }

  const running = jobs.find(
    (j) => (j.status === 'queued' || j.status === 'running') && !isOrchestratorJobRecord(j),
  )
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
  const open = [...ledger.sessions]
    .reverse()
    .find((s) => s.status === 'open' && s.sessionId && !isOrchestratorEntry(s))
  const entry =
    byStep ?? open ?? [...ledger.sessions].reverse().find((s) => s.sessionId && !isOrchestratorEntry(s))
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

  const anyJob = jobs.find((j) => j.sessionId && !isOrchestratorJobRecord(j))
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
  // xem docs/architecture/code/monitor.md §4
  const orchestratorPanel = opts.stepId === ORCHESTRATOR_STEP_ID
  const ownJobs = orchestratorPanel ? jobs.filter((j) => j.metadata?.orchestratorJob === true) : jobs
  const runningJob = ownJobs.find((j) => j.status === 'queued' || j.status === 'running')
  const hasFinished = jobs.some((j) => j.status === 'succeeded' || j.status === 'failed')

  let blockedReason: TaskChatBlockedReason | undefined
  if (!runningJob && !hasFinished) blockedReason = 'noCompletedJob'

  const resolved = resolveChatSession(projectId, taskId, opts.stepId)
  const reader = transcriptReaderFor(resolved.providerId || resolved.entry?.providerId)
  const transcript: TranscriptReadResult = resolved.sessionId
    ? reader.read(resolved.sessionId, resolved.workspace, {
        fromIndex: opts.fromIndex,
        includeToolActivity: opts.includeToolActivity,
      })
    : { turns: [], total: 0, file: null, provider: reader.label }

  const runnerJob =
    runningJob ??
    (opts.stepId
      ? jobs.find((j) => stepIdOf(j) === opts.stepId && (j.status === 'succeeded' || j.status === 'failed'))
      : undefined) ??
    resolved.job ??
    (orchestratorPanel
      ? undefined
      : (jobs.find((j) => j.status === 'succeeded' || j.status === 'failed') ?? jobs[0]))
  const runnerConfig = runnerJob ? getRunner(runnerJob.runnerId) : null

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
    const synthesized = synthesizeTurnsFromJobs(jobSource)
    if (synthesized.length) {
      turns = synthesized.filter((t) => t.index >= from)
      total = synthesized.length
      transcriptFound = true
    }
  }

  turns = turns.filter((t) => !(t.index === 0 && t.role === 'user'))

  if (resolved.sessionId && !transcriptFound) transcriptMissingReason = reader.missingReason()

  return {
    taskId,
    stepId: opts.stepId,
    sessionId: resolved.sessionId,
    transcriptFound,
    ...(transcriptMissingReason ? { transcriptMissingReason } : {}),
    transcriptProvider: transcript.provider,
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
