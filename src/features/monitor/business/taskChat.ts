import { getRunner, listJobs, loadTaskSessionLedger, stepIdOf } from '../runners/index.js'
import type { JobRecord, SessionEntry } from '../runners/index.js'
import { readSessionTranscript, type TranscriptTurn } from './sessionTranscript.js'

/**
 * State for "chat trực tiếp với runner": the conversation history of the CLI
 * session a pipeline step ran under, plus whether a message can be sent right
 * now. History comes from the CLI's own session transcript
 * (`sessionTranscript.ts`), which the CLI appends to while it works — so the
 * same endpoint doubles as live monitoring of a running step instead of only
 * showing the result once it finishes.
 *
 * Sending itself stays `sendTaskFeedback()` (F0011); this module only mirrors
 * its guards so the UI can explain *why* the input is blocked before the user
 * types, instead of surfacing a 400/409 after the fact.
 */

export type TaskChatBlockedReason = 'stepRunning' | 'noCompletedJob' | 'noSession'

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
  turns: TranscriptTurn[]
  /** Total turns in the transcript — pass back as `fromIndex` to poll. */
  total: number
  running: TaskChatRunningJob | null
  runner: TaskChatRunner | null
  canSend: boolean
  blockedReason?: TaskChatBlockedReason
  /** Set when the ledger entry we would resume is no longer usable. */
  staleReason?: string
}

function jobsOfTask(taskId: string): JobRecord[] {
  return listJobs(200)
    .filter((j) => j.metadata?.taskId === taskId && !j.applyTarget)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
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
): { sessionId: string | null; workspace?: string; entry?: SessionEntry; staleReason?: string } {
  const jobs = jobsOfTask(taskId)
  const running = jobs.find((j) => j.status === 'queued' || j.status === 'running')
  if (running?.sessionId && (!stepId || stepIdOf(running) === stepId || !stepIdOf(running))) {
    return { sessionId: running.sessionId, workspace: running.workspace }
  }

  if (stepId) {
    const ofStep = jobs.find((j) => stepIdOf(j) === stepId && j.sessionId)
    if (ofStep?.sessionId) return { sessionId: ofStep.sessionId, workspace: ofStep.workspace }
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
      staleReason: entry.status === 'stale' || entry.status === 'archived' ? entry.staleReason || entry.status : undefined,
    }
  }

  const anyJob = jobs.find((j) => j.sessionId)
  return anyJob?.sessionId ? { sessionId: anyJob.sessionId, workspace: anyJob.workspace } : { sessionId: null }
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
  const ledger = loadTaskSessionLedger(projectId, taskId)
  const hasOpenSession = ledger.sessions.some((s) => s.status === 'open')

  // Mirrors sendTaskFeedback()'s guard order exactly.
  let blockedReason: TaskChatBlockedReason | undefined
  if (runningJob) blockedReason = 'stepRunning'
  else if (!hasFinished) blockedReason = 'noCompletedJob'
  else if (!hasOpenSession) blockedReason = 'noSession'

  const resolved = resolveChatSession(projectId, taskId, opts.stepId)
  const transcript = resolved.sessionId
    ? readSessionTranscript(resolved.sessionId, resolved.workspace, {
        fromIndex: opts.fromIndex,
        includeToolActivity: opts.includeToolActivity,
      })
    : { turns: [], total: 0, file: null }

  // The runner that ran (or is running) this step — the running job wins, else
  // the newest job of the step/task, mirroring resolveChatSession()'s order.
  const runnerJob =
    runningJob ??
    (opts.stepId ? jobs.find((j) => stepIdOf(j) === opts.stepId) : undefined) ??
    jobs[0]
  const runnerConfig = runnerJob ? getRunner(runnerJob.runnerId) : null

  return {
    taskId,
    stepId: opts.stepId,
    sessionId: resolved.sessionId,
    transcriptFound: Boolean(transcript.file),
    turns: transcript.turns,
    total: transcript.total,
    running: runningJob
      ? { jobId: runningJob.id, stepId: stepIdOf(runningJob), startedAt: runningJob.startedAt }
      : null,
    runner: runnerConfig
      ? { id: runnerConfig.id, name: runnerConfig.name || runnerConfig.id, enabled: runnerConfig.enabled !== false }
      : runnerJob
        ? // Job recorded a runner id that no longer exists in the registry.
          { id: runnerJob.runnerId, name: runnerJob.runnerId, enabled: false }
        : null,
    canSend: !blockedReason,
    ...(blockedReason ? { blockedReason } : {}),
    ...(resolved.staleReason ? { staleReason: resolved.staleReason } : {}),
  }
}
