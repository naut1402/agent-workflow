import { cpSync, dirname, joinPath, mkdirSync, readTextFileSync, readdirSync, resolvePath, rmSync, writeTextFileAtomicSync, writeTextFileSync } from '../../../core/lib/fileHelper.js'
import crypto from 'node:crypto'
import { spawn } from '../../../core/lib/processHelper.js'
import os from 'node:os'
import { registryHome } from '../../../core/registry.js'
import { isLogTypeEnabled } from '../../../core/log/loggingPrefsIo.js'
import { emit } from '../../../core/events/index.js'
import { getRunner, getDefaultRunner, substituteConfig, getProvider } from './registry.js'
import { getConnection } from './connections.js'
import { getCredential } from './credentials.js'
import { resolveAgent } from './agentResolver.js'
import { loadTaskSessionLedger, recordSessionUsage, resolveSessionPlan, mintSessionId, type SessionMode } from './sessionLedger.js'
import { isAgentCliProviderId } from './providers/agentCli.js'
import { captureJobUsage, captureTokenUsageFromExecute } from './usageCapture.js'
import type { Connection, CredentialProfile, ExecuteResult, JobRecord, JobStatus, MutationResult } from './types.js'
import type { UsageSnapshot } from '../../../core/log/schema.js'
import { advanceStepOnJobSuccess, loadPipelineConfig, queuePendingFeedback, takePendingFeedback } from './index.js'
import { classifyJobFailure, parseUsageResetAt } from './classifyJobFailure.js'
import { loadRecoverEntry, removeRecoverEntry, saveRecoverEntry } from './recoverLedger.js'
import { bindRecoverPoller, startRecoverPoller } from './recoverPoller.js'
import { loadRecoverySettings } from '../../settings/business/dashboardSettings.js'
import {
  DEFAULT_RECOVERY_SETTINGS,
  resolveRecoveryBackoffMs,
  resolveRecoveryMaxAttempts,
} from '../../settings/schemas/recovery.js'

/** Cap on stdout persisted for chat surfaces (NL chat + task chat fallback). */
const CHAT_STDOUT_LIMIT = 64 * 1024

/** Compile-time default — actual cap is `settings.recovery.maxAttempts` (Settings › Job recovery). */
export const FAILURE_MAX_ATTEMPTS = DEFAULT_RECOVERY_SETTINGS.maxAttempts!

function backoffMsFor(attemptCount: number, schedule: number[]): number {
  return schedule[Math.min(attemptCount - 1, schedule.length - 1)] ?? schedule[schedule.length - 1]
}

/**
 * In-flight `AbortController` per running job — the counterpart of `job.pid` for
 * providers with no OS subprocess to SIGTERM (`AgenticApiProvider` subclasses,
 * see providers/agenticApiProvider.ts). `cancelJob` aborts through this map;
 * `runJob` always removes its entry once `provider.execute()` settles.
 */
const jobAbortControllers = new Map<string, AbortController>()

/** Persist agent reply on the job record for chat UI (NL + pipeline task chat). */
function shouldPersistStdout(job: JobRecord, providerId: string | undefined): boolean {
  if (job.metadata?.isNlChat) return true
  return Boolean(providerId && isAgentCliProviderId(providerId))
}

/**
 * The pipeline step a job belongs to. Pipeline run-step jobs tag
 * `pipelineStepId`; ad-hoc/quick-action jobs use `stepId`.
 */
export function stepIdOf(job: JobRecord): string | undefined {
  const meta = job.metadata || {}
  if (typeof meta.stepId === 'string' && meta.stepId) return meta.stepId
  if (typeof meta.pipelineStepId === 'string' && meta.pipelineStepId) return meta.pipelineStepId
  return undefined
}

function credentialForConnection(conn: Connection): CredentialProfile | null {
  if (conn.kind === 'local-console') {
    return {
      id: 'cli-session-implicit',
      provider: conn.providerId,
      label: 'CLI session',
      secretRef: 'cli-session',
    }
  }
  if (!conn.credentialId) return null
  return getCredential(conn.credentialId)
}

function mergeRunnerConfig(runnerConfig: Record<string, any>, conn: Connection): Record<string, any> {
  return {
    ...runnerConfig,
    cliPath: conn.cliPath || runnerConfig.cliPath,
    flags: Array.isArray(conn.flags) ? conn.flags : runnerConfig.flags || [],
    ...(conn.config && typeof conn.config === 'object' ? conn.config : {}),
  }
}

export interface SubmitJobInput {
  runnerId?: string
  agentRef: string
  workspace: string
  userPrompt?: string
  promptRef?: string
  produces?: string[]
  metadata?: Record<string, unknown>
  /** Explicit session control for pipeline resume (additive — optional). */
  sessionMode?: SessionMode
  sessionId?: string
  /** The job this one continues/follows-up on (e.g. a task-chat-feedback round). */
  parentJobId?: string
}

function requeueJob(jobId: string): void {
  queue.push(jobId)
  pumpQueue()
}

bindRecoverPoller({ loadJob, saveJob, requeueJob })

// Reap orphaned running jobs once when the module loads (server restart).
reapOrphanedRunningJobs()
startRecoverPoller()

function jobsDir(): string {
  return joinPath(registryHome(), 'jobs')
}

function jobFile(id: string): string {
  return joinPath(jobsDir(), `${id}.json`)
}

function ensureJobsDir(): void {
  mkdirSync(jobsDir(), { recursive: true })
}

// ── Approval flow (see JobRecord's sessionId/applyTarget/approvalArtifact/
// parentJobId doc comments in types.ts) ─────────────────────────────────────
// A `require_approval` quick action runs against a throwaway copy of the task
// workspace under the dashboard's own registry home — never the real project
// tree — so nothing is written to the user's files until they explicitly
// approve. `~/.dev-team-dashboard/proposals/<jobId>/` mirrors the `jobs/`
// directory's placement (outside any git-tracked tree).

function proposalsDir(): string {
  return joinPath(registryHome(), 'proposals')
}

function scratchWorkspacePath(jobId: string): string {
  return joinPath(proposalsDir(), jobId)
}

function copyWorkspaceForApproval(realWorkspace: string, jobId: string): string {
  const scratch = scratchWorkspacePath(jobId)
  mkdirSync(dirname(scratch), { recursive: true })
  cpSync(realWorkspace, scratch, { recursive: true })
  return scratch
}

function removeScratchWorkspace(scratchPath: string): void {
  try {
    rmSync(scratchPath, { recursive: true, force: true })
  } catch {
    /* ignore — best-effort cleanup */
  }
}

// ── Selection splice helpers (pure) ─────────────────────────────────────────
// A selection quick action must only ever touch the lines the user picked. The
// agent improves just the snippet (in a scratch file); the server then splices
// that result back into a copy of the real artifact at the same line range so
// every other line stays byte-identical. These helpers are exported for unit
// tests.

/** File's dominant line ending — CRLF if any `\r\n` is present, else LF. */
export function detectEol(content: string): '\r\n' | '\n' {
  return /\r\n/.test(content) ? '\r\n' : '\n'
}

function clampRange(lineCount: number, start: number, end: number): { start: number; end: number } {
  const s = Math.min(Math.max(1, Math.floor(start)), Math.max(1, lineCount))
  const e = Math.min(Math.max(s, Math.floor(end)), Math.max(1, lineCount))
  return { start: s, end: e }
}

/** Extract lines [start..end] (1-indexed, inclusive) of `content`, joined with LF. */
export function extractLines(content: string, start: number, end: number): string {
  const lines = content.split(/\r?\n/)
  const { start: s, end: e } = clampRange(lines.length, start, end)
  return lines.slice(s - 1, e).join('\n')
}

/**
 * Replace lines [start..end] (1-indexed, inclusive) of `base` with
 * `replacement`, preserving `base`'s original line ending everywhere so only
 * the replaced region can differ from the original. `replacement` may have any
 * number of lines (and any EOL); a single trailing newline on it is dropped so
 * the splice doesn't inject a spurious blank line.
 */
export function spliceLines(base: string, start: number, end: number, replacement: string): string {
  const eol = detectEol(base)
  const baseLines = base.split(/\r?\n/)
  const { start: s, end: e } = clampRange(baseLines.length, start, end)
  let replLines = replacement.split(/\r?\n/)
  if (replLines.length > 1 && replLines[replLines.length - 1] === '') replLines.pop()
  return [...baseLines.slice(0, s - 1), ...replLines, ...baseLines.slice(e)].join(eol)
}

// Markdown-insensitive comparison key: drop inline markers (backticks,
// emphasis) and collapse whitespace, so selected *rendered* text (which has had
// its markdown stripped by the viewer, e.g. `code` → code) can still be located
// in the raw markdown *source*.
function normalizeForMatch(s: string): string {
  return s
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Locate `selectedText` (as captured from the rendered viewer, so markdown
 * syntax may be stripped) within the raw markdown `content`, returning the
 * tightest 1-indexed inclusive source line range whose text matches. Returns
 * null if no run of lines matches — the caller then falls back to the viewer's
 * best-effort line range. This is what keeps a splice limited to the lines the
 * user actually selected instead of the whole rendered block.
 */
export function findSelectionRange(content: string, selectedText: string): { start: number; end: number } | null {
  const normSel = normalizeForMatch(selectedText)
  if (!normSel) return null
  const normLines = content.split(/\r?\n/).map(normalizeForMatch)
  const MAX_SPAN = 400
  let best: { start: number; end: number; span: number } | null = null
  for (let i = 0; i < normLines.length; i++) {
    if (!normLines[i]) continue // a match can't start on a blank/markup-only line
    let acc = ''
    for (let j = i; j < normLines.length && j - i <= MAX_SPAN; j++) {
      if (normLines[j]) acc = acc ? `${acc} ${normLines[j]}` : normLines[j]
      if (acc.includes(normSel)) {
        const span = j - i
        if (!best || span < best.span) best = { start: i + 1, end: j + 1, span }
        break // smallest window starting at i
      }
      if (acc.length > normSel.length + 400) break // grown well past the target — give up on this start
    }
  }
  return best ? { start: best.start, end: best.end } : null
}

/**
 * Strip a quick-action agent's stdout down to just the proposed content: trim
 * surrounding whitespace and unwrap a single enclosing markdown code fence (the
 * common "```markdown … ```" the model sometimes adds despite being asked not
 * to). Best-effort — the user still reviews the diff before it's applied.
 */
export function cleanAgentOutput(stdout: string): string {
  const t = stdout.trim()
  const fenced = t.match(/^```[^\n]*\n([\s\S]*?)\n?```$/)
  return (fenced ? fenced[1] : t).trim()
}

/**
 * Fold a successful approval job's proposed content (the agent's stdout) into
 * the scratch artifact so the review diff (real vs scratch artifact) reflects
 * the proposal. For a selection job (`spliceRange` set) the stdout is spliced
 * into a copy of the real artifact at that line range — every other line stays
 * byte-identical, incl. the original EOL. For a whole-file job the stdout
 * replaces the scratch artifact outright; if the agent produced no stdout (a
 * "write the file with your Write tool" style prompt), the scratch artifact the
 * agent wrote is left as-is. Throws on unreadable/unwritable paths.
 */
function foldProposalIntoScratch(job: JobRecord, stdout: string): void {
  const proposed = cleanAgentOutput(stdout)
  const scratchArtifact = joinPath(job.workspace, job.approvalArtifact!)
  if (job.spliceRange) {
    let base = ''
    try {
      base = readTextFileSync(joinPath(job.applyTarget!, job.approvalArtifact!))
    } catch {
      base = '' // real artifact may not exist yet
    }
    const spliced = spliceLines(base, job.spliceRange.start, job.spliceRange.end, proposed)
    writeTextFileSync(scratchArtifact, spliced)
  } else if (proposed) {
    writeTextFileSync(scratchArtifact, proposed)
  }
  // else: whole-file job with no stdout — keep whatever the agent wrote.
}

export function loadJob(id: string): JobRecord | null {
  try {
    return JSON.parse(readTextFileSync(jobFile(id)))
  } catch {
    return null
  }
}

function saveJob(job: JobRecord): JobRecord {
  ensureJobsDir()
  writeTextFileAtomicSync(jobFile(job.id), JSON.stringify(job, null, 2))
  return job
}

/** Merge usage onto an existing job record (usage capture path). */
export function mergeJobUsage(id: string, usage: UsageSnapshot): JobRecord | null {
  const cur = loadJob(id)
  if (!cur) return null
  return saveJob({ ...cur, usage })
}

export function listJobs(limit?: number, status?: JobStatus): JobRecord[] {
  ensureJobsDir()
  const files = readdirSync(jobsDir()).filter((f) => f.endsWith('.json'))
  let jobs = files
    .map((f): JobRecord | null => {
      try {
        return JSON.parse(readTextFileSync(joinPath(jobsDir(), f)))
      } catch {
        return null
      }
    })
    .filter((j): j is JobRecord => Boolean(j?.id))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  if (status) {
    jobs = jobs.filter((j) => j.status === status)
  }
  const effectiveLimit =
    limit !== undefined && limit !== null && Number.isFinite(limit) && limit > 0
      ? Math.floor(limit)
      : status
        ? undefined
        : 20
  return effectiveLimit !== undefined ? jobs.slice(0, effectiveLimit) : jobs
}

/** Per-task concurrency: same task stays serial; different tasks run in parallel. */
const runningTaskKeys = new Set<string>()
const queue: string[] = []
let pumpScheduled = false

function taskKey(job: JobRecord): string {
  const tid = job.metadata?.taskId
  return typeof tid === 'string' && tid ? `task:${tid}` : `job:${job.id}`
}

function pumpQueue(): void {
  if (pumpScheduled) return
  pumpScheduled = true
  queueMicrotask(() => {
    pumpScheduled = false
    for (let i = 0; i < queue.length; ) {
      const id = queue[i]
      const job = loadJob(id)
      if (!job || job.status !== 'queued') {
        queue.splice(i, 1)
        continue
      }
      const key = taskKey(job)
      if (runningTaskKeys.has(key)) {
        i++
        continue
      }
      queue.splice(i, 1)
      runningTaskKeys.add(key)
      void runJob(job)
        .catch((err) => {
          console.error('[jobQueue]', err)
        })
        .finally(() => {
          runningTaskKeys.delete(key)
          pumpQueue()
        })
    }
  })
}

async function runJob(job: JobRecord): Promise<void> {
  const runner = getRunner(job.runnerId) || getDefaultRunner()
  if (!runner || runner.enabled === false) {
    saveJob({
      ...job,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: 'runner not found or disabled',
    })
    emit('job.failed', { jobId: job.id, error: 'runner not found or disabled' })
    return
  }

  const connection = getConnection(runner.connectionId)
  if (!connection) {
    const error = `connection not found: ${runner.connectionId}`
    saveJob({
      ...job,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error,
    })
    emit('job.failed', { jobId: job.id, error })
    return
  }

  const credential = credentialForConnection(connection)
  if (!credential) {
    const error = `credential not found for connection: ${runner.connectionId}`
    saveJob({
      ...job,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error,
    })
    emit('job.failed', { jobId: job.id, error })
    return
  }

  const provider = getProvider(connection.providerId)
  if (!provider) {
    const error = `unknown provider: ${connection.providerId}`
    saveJob({
      ...job,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error,
    })
    emit('job.failed', { jobId: job.id, error })
    return
  }

  const logPath = isLogTypeEnabled('jobs') ? joinPath(jobsDir(), `${job.id}.log`) : undefined
  if (logPath) {
    try {
      writeTextFileSync(logPath, '')
    } catch {
      /* ignore */
    }
  }

  saveJob({ ...job, status: 'running', startedAt: new Date().toISOString(), logPath: logPath ?? null, pid: null })
  emit('job.started', {
    jobId: job.id,
    runnerId: runner.id,
    providerId: connection.providerId,
    taskId: job.metadata?.taskId,
    projectId: job.metadata?.projectId,
  })

  let userPrompt = job.userPrompt || ''
  if (!userPrompt && job.promptRef) {
    try {
      userPrompt = readTextFileSync(job.promptRef)
    } catch (err: any) {
      saveJob({
        ...(loadJob(job.id) as JobRecord),
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: `cannot read prompt: ${err.message}`,
      })
      emit('job.failed', { jobId: job.id, error: 'cannot read prompt' })
      return
    }
  }

  const projectRoot = (job.metadata?.projectRoot as string) || dirname(job.workspace)
  const devTeamRoot = (job.metadata?.devTeamRoot as string) || job.workspace

  let resolvedAgent
  try {
    // Console-command providers never merge an agent system prompt — ignore any
    // agentRef the client may still send.
    if (connection.providerId === 'console-command') {
      resolvedAgent = await resolveAgent('', { projectRoot, devTeamRoot })
    } else {
      resolvedAgent = await resolveAgent(job.agentRef, { projectRoot, devTeamRoot })
    }
  } catch (err: any) {
    const error = String(err.message || err)
    saveJob({
      ...(loadJob(job.id) as JobRecord),
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error,
    })
    emit('job.failed', { jobId: job.id, error })
    return
  }

  const runnerConfig = mergeRunnerConfig(
    substituteConfig(runner.config, { projectRoot }) as Record<string, any>,
    connection,
  )

  const taskId = typeof job.metadata?.taskId === 'string' ? job.metadata.taskId : undefined
  const projectId = typeof job.metadata?.projectId === 'string' ? job.metadata.projectId : undefined
  const inputSessionMode = job.metadata?.inputSessionMode as SessionMode | undefined
  const inputSessionId = typeof job.metadata?.inputSessionId === 'string' ? job.metadata.inputSessionId : undefined

  let execSessionId: string | undefined
  let execResumeSessionId: string | undefined
  let sessionStaleReason: string | undefined

  // Reading only `metadata.stepId` left every ledger entry's `stepIds` empty
  // for pipeline jobs (they tag `pipelineStepId`), so per-step session lookup
  // had nothing to match on — see stepIdOf().
  const jobStepId = stepIdOf(job)

  if (job.applyTarget && job.approvalArtifact) {
    execSessionId = job.sessionId && !job.parentJobId ? job.sessionId : undefined
    execResumeSessionId = job.sessionId && job.parentJobId ? job.sessionId : undefined
  } else if (taskId && projectId && inputSessionMode && inputSessionMode !== 'none') {
    const plan = resolveSessionPlan({
      projectId,
      taskId,
      sessionMode: inputSessionMode,
      sessionId: inputSessionId,
      providerId: connection.providerId,
      runnerId: runner.id,
      connectionId: connection.id,
      workspace: job.workspace,
      host: os.hostname(),
      model: resolvedAgent.model,
      stepId: jobStepId,
    })
    sessionStaleReason = plan.staleReason
    if (plan.sessionMode === 'resume' && plan.resumeSessionId) {
      execResumeSessionId = plan.resumeSessionId
    } else if (plan.sessionMode === 'new') {
      execSessionId = plan.sessionId || mintSessionId()
      recordSessionUsage({
        projectId,
        taskId,
        sessionId: execSessionId,
        providerId: connection.providerId,
        runnerId: runner.id,
        connectionId: connection.id,
        workspace: job.workspace,
        model: resolvedAgent.model,
        stepId: jobStepId,
        forceNew: true,
        staleReason: sessionStaleReason,
      })
    }
  }

  // Record the session id on the job BEFORE the CLI runs: the chat surface
  // finds the runner's live transcript by session id, and the ledger is only
  // updated after the job finishes (`recordSessionUsage` below) — too late to
  // watch a run in progress.
  const plannedSessionId = execSessionId ?? execResumeSessionId
  if (plannedSessionId && !job.applyTarget) {
    const current = loadJob(job.id)
    if (current) saveJob({ ...current, sessionId: plannedSessionId })
  }

  const onStart = (info: { pid: number | null }) => {
    const current = loadJob(job.id)
    if (!current || current.status !== 'running') return
    saveJob({ ...current, pid: info.pid ?? null })
  }

  const abortController = new AbortController()
  jobAbortControllers.set(job.id, abortController)

  let result: ExecuteResult
  try {
    result = await provider.execute(
      {
        jobId: job.id,
        resolvedAgent,
        userPrompt,
        workspace: job.workspace,
        produces: job.produces,
        timeoutMs: runnerConfig.timeoutMs,
        metadata: {
          ...job.metadata,
          logPath,
          jobId: job.id,
          providerId: connection.providerId,
          runnerId: runner.id,
          connectionId: connection.id,
        },
        sessionId: execSessionId,
        resumeSessionId: execResumeSessionId,
        signal: abortController.signal,
      },
      runnerConfig,
      credential,
      undefined,
      onStart,
    )
  } finally {
    jobAbortControllers.delete(job.id)
  }

  // `cancelJob` already set `status: 'cancelled'` and this SIGTERM/abort is why
  // `provider.execute()` just resolved — `result.ok` will be false, and
  // without this guard the code below would overwrite it with `'failed'`.
  // Session + usage capture still run first: tokens were spent even on cancel.
  const capturedSessionId = result.sessionId ?? execSessionId ?? execResumeSessionId
  if (taskId && projectId && inputSessionMode && inputSessionMode !== 'none' && capturedSessionId) {
    recordSessionUsage({
      projectId,
      taskId,
      sessionId: capturedSessionId,
      providerId: connection.providerId,
      runnerId: runner.id,
      connectionId: connection.id,
      workspace: job.workspace,
      model: resolvedAgent.model,
      stepId: jobStepId,
    })
  }

  if (capturedSessionId && connection.providerId === 'claude-code-cli') {
    const current = loadJob(job.id) || job
    void captureJobUsage(
      { ...current, sessionId: capturedSessionId },
      capturedSessionId,
      connection.providerId,
    ).catch(() => {})
  }

  // Cursor (and other parse-json CLIs) already emit usage on ExecuteResult —
  // persist when present so Logs → Usage is not Claude-only.
  if (result.tokenUsage) {
    const current = loadJob(job.id) || job
    void captureTokenUsageFromExecute(
      { ...current, ...(capturedSessionId ? { sessionId: capturedSessionId } : {}) },
      connection.providerId,
      result.tokenUsage,
      capturedSessionId ?? null,
    ).catch(() => {})
  }

  if (loadJob(job.id)?.status === 'cancelled') return

  const isApprovalJob = Boolean(job.applyTarget && job.approvalArtifact)
  const isChatFeedback = Boolean(job.metadata?.isChatFeedback)
  if (!result.ok && isApprovalJob) removeScratchWorkspace(job.workspace)

  if (!result.ok) {
    const recoverySettings = loadRecoverySettings()
    const kind = recoverySettings.enabled ? classifyJobFailure(result) : null
    const current = loadJob(job.id) as JobRecord
    const prevAttempts = current.attemptCount ?? 0

    if (kind === 'usage_limit' || kind === 'network') {
      const usageResetAt = kind === 'usage_limit' ? parseUsageResetAt(result.error ?? '') : null
      const resumeAfter =
        usageResetAt ??
        new Date(
          Date.now() +
            (kind === 'network'
              ? (recoverySettings.networkResumeDelayMs ?? DEFAULT_RECOVERY_SETTINGS.networkResumeDelayMs!)
              : (recoverySettings.usageLimitResumeDelayMs ?? DEFAULT_RECOVERY_SETTINGS.usageLimitResumeDelayMs!)),
        )
      saveRecoverEntry({
        version: 1,
        jobId: job.id,
        kind,
        attemptCount: prevAttempts,
        resumeAfter: resumeAfter.toISOString(),
        createdAt: new Date().toISOString(),
        lastError: result.error,
        usageResetAt: usageResetAt?.toISOString() ?? null,
      })
      saveJob({
        ...current,
        status: 'awaiting_recovery',
        finishedAt: null,
        exitCode: result.exitCode,
        error: result.error,
        logPath: result.logPath,
        pid: null,
        attemptCount: prevAttempts,
        failureKind: kind,
      })
      emit('job.awaiting_recovery', {
        jobId: job.id,
        kind,
        resumeAfter: resumeAfter.toISOString(),
        taskId,
        projectId,
      })
      return
    }

    if (kind === 'process_crash') {
      const maxAttempts = resolveRecoveryMaxAttempts(recoverySettings)
      const nextAttempt = prevAttempts + 1
      if (nextAttempt < maxAttempts) {
        const schedule = resolveRecoveryBackoffMs(recoverySettings)
        const delay = backoffMsFor(nextAttempt, schedule)
        const resumeAfter = new Date(Date.now() + delay)
        saveRecoverEntry({
          version: 1,
          jobId: job.id,
          kind: 'process_crash',
          attemptCount: nextAttempt,
          resumeAfter: resumeAfter.toISOString(),
          createdAt: new Date().toISOString(),
          lastError: result.error,
        })
        saveJob({
          ...current,
          status: 'queued',
          attemptCount: nextAttempt,
          failureKind: kind,
          error: result.error,
          pid: null,
          finishedAt: null,
          exitCode: result.exitCode,
          logPath: result.logPath,
        })
        emit('job.retry_scheduled', {
          jobId: job.id,
          attemptCount: nextAttempt,
          resumeAfter: resumeAfter.toISOString(),
          taskId,
          projectId,
        })
        return
      }
    }
  }

  // Fold the agent's proposed content (stdout) into the scratch artifact so the
  // review diff reflects the proposal — spliced into the selected line range for
  // a selection job, or replacing the whole file otherwise.
  if (result.ok && isApprovalJob) {
    try {
      foldProposalIntoScratch(job, result.stdout ?? '')
    } catch (err: any) {
      removeScratchWorkspace(job.workspace)
      saveJob({
        ...(loadJob(job.id) as JobRecord),
        status: 'failed',
        finishedAt: new Date().toISOString(),
        exitCode: result.exitCode,
        error: `cannot apply proposed content: ${err.message}`,
        logPath: result.logPath,
      })
      emit('job.failed', { jobId: job.id, error: 'cannot apply proposed content', taskId, projectId })
      return
    }
  }

  // Advance current_phase (and optionally chain the next step) while this job
  // is still `running`, then mark succeeded — so the UI cannot submit another
  // run-step against a stale phase between "job done" and "phase advanced".
  // Chat-feedback jobs skip advance (they must not move the pipeline cursor).
  if (result.ok && !isApprovalJob && !isChatFeedback) {
    try {
      await advancePipelineStepChain(job)
    } finally {
      saveJob({
        ...(loadJob(job.id) as JobRecord),
        status: 'succeeded',
        finishedAt: new Date().toISOString(),
        exitCode: result.exitCode,
        error: result.error,
        logPath: result.logPath,
        artifactsFound: result.artifactsFound,
        pid: null,
        ...(shouldPersistStdout(job, connection.providerId)
          ? { stdout: (result.stdout ?? '').slice(0, CHAT_STDOUT_LIMIT) }
          : {}),
        ...(capturedSessionId ? { sessionId: capturedSessionId } : {}),
      })
      emit('job.finished', { jobId: job.id, status: 'succeeded', taskId, projectId })
    }
    await resubmitPendingFeedback(job)
    return
  }

  const finalStatus = result.ok ? (isApprovalJob ? 'awaiting_approval' : 'succeeded') : 'failed'
  saveJob({
    ...(loadJob(job.id) as JobRecord),
    status: finalStatus,
    finishedAt: new Date().toISOString(),
    exitCode: result.exitCode,
    error: result.error,
    logPath: result.logPath,
    artifactsFound: result.artifactsFound,
    pid: null,
    // Task/NL chat read the agent's reply from here: the log file also contains
    // the payload/prompt framing, which must never be shown as the chat answer.
    ...(shouldPersistStdout(job, connection.providerId)
      ? { stdout: (result.stdout ?? '').slice(0, CHAT_STDOUT_LIMIT) }
      : {}),
    ...(capturedSessionId && !isApprovalJob ? { sessionId: capturedSessionId } : {}),
  })
  emit(result.ok ? 'job.finished' : 'job.failed', {
    jobId: job.id,
    status: finalStatus,
    taskId,
    projectId,
    ...(result.ok ? {} : { error: result.error }),
  })
  if (!isApprovalJob) await resubmitPendingFeedback(job)
}

/**
 * A step's chat surface may queue feedback (`queuePendingFeedback`) while its
 * job is still running — once that job (or a chat-feedback job resuming the
 * same session) finishes, resubmit whatever is queued. Approval jobs are
 * excluded: quick-action scratch runs aren't a task's pipeline step chat.
 */
async function resubmitPendingFeedback(job: JobRecord): Promise<void> {
  const taskId = typeof job.metadata?.taskId === 'string' ? job.metadata.taskId : undefined
  const devTeamRoot = typeof job.metadata?.devTeamRoot === 'string' ? job.metadata.devTeamRoot : undefined
  const projectId = typeof job.metadata?.projectId === 'string' ? job.metadata.projectId : ''
  if (!taskId || !devTeamRoot) return
  const pending = await takePendingFeedback(devTeamRoot, taskId)
  if (!pending) return
  try {
    const res = await sendTaskFeedback(taskId, projectId, pending.feedback, { stepId: pending.stepId })
    if (res.ok === false) {
      console.error('[jobQueue] queued feedback rejected on resubmit', res.error)
      await queuePendingFeedback(devTeamRoot, taskId, pending)
    }
  } catch (err) {
    console.error('[jobQueue] failed to resubmit queued feedback', err)
    await queuePendingFeedback(devTeamRoot, taskId, pending)
  }
}

/**
 * Dashboard "run step" jobs tag `metadata.pipelineStepId` (the step the job
 * just ran) and, for a jump-to-target run, `metadata.chainTarget` (the step
 * the user clicked). On success, `advanceStepOnJobSuccess` either advances
 * `current_phase` past a gate-less step or opens the step's HITL gate.
 * Every successful gate-less step keeps this chain going automatically —
 * a `chainTarget`, when present, only makes it stop exactly there instead of
 * running further. A HITL gate (or a step id / agent we don't recognise, or
 * a missing `request.md`) always stops the chain regardless of `chainTarget`.
 */
async function advancePipelineStepChain(job: JobRecord): Promise<void> {
  const taskId = typeof job.metadata?.taskId === 'string' ? job.metadata.taskId : undefined
  const devTeamRoot = typeof job.metadata?.devTeamRoot === 'string' ? job.metadata.devTeamRoot : undefined
  const pipelineStepId = typeof job.metadata?.pipelineStepId === 'string' ? job.metadata.pipelineStepId : undefined
  const chainTarget = typeof job.metadata?.chainTarget === 'string' ? job.metadata.chainTarget : undefined
  if (!taskId || !devTeamRoot || !pipelineStepId) return

  const advanced = await advanceStepOnJobSuccess(devTeamRoot, taskId, pipelineStepId)
  if (!advanced) return
  // Stop once the clicked node itself has run, even if it advanced further —
  // the user only asked to reach `chainTarget`, not run past it.
  if (chainTarget && pipelineStepId === chainTarget) return

  const nextStepId = String(advanced.state.current_phase ?? '')
  if (!nextStepId || nextStepId === 'completed' || nextStepId === pipelineStepId) return
  if (advanced.state.hitl_pending) return // gate reached — wait for approve/reject

  const pipeline = await loadPipelineConfig(devTeamRoot, taskId)
  const nextStep = (pipeline.steps || []).find((s: any) => s.id === nextStepId)
  if (!nextStep?.agent) return

  const workspace = joinPath(devTeamRoot, 'tasks', taskId)
  let userPrompt = ''
  try {
    userPrompt = readTextFileSync(joinPath(workspace, 'request.md'))
  } catch {
    return // no request.md — leave the chain to stop rather than run with an empty prompt
  }

  // Drop `isChatFeedback` before spreading `job.metadata` into the next step's
  // job — it marks only the job it was set on (a chat-resume round), and would
  // otherwise leak forward onto every step the chain submits afterwards,
  // wrongly suppressing advancePipelineStepChain for all of them.
  const { isChatFeedback: _isChatFeedback, ...carryMetadata } = job.metadata || {}

  submitJob({
    runnerId: job.runnerId === 'unknown' ? undefined : job.runnerId,
    agentRef: nextStep.agent,
    workspace,
    userPrompt,
    produces: Array.isArray(nextStep.produces) ? nextStep.produces : undefined,
    // Fresh CLI session per step — do not resume the previous step's context.
    sessionMode: 'new',
    metadata: {
      ...carryMetadata,
      pipelineStepId: nextStepId,
      chainTarget,
    },
  })
}

export function submitJob(input: SubmitJobInput): JobRecord {
  const id = crypto.randomUUID()
  const runner = input.runnerId ? getRunner(input.runnerId) : getDefaultRunner()

  let sessionMode = input.sessionMode
  if (!sessionMode && input.metadata?.createTaskRun && input.metadata?.taskId) {
    sessionMode = 'new'
  }

  const job: JobRecord = {
    id,
    status: 'queued',
    runnerId: runner?.id || input.runnerId || 'unknown',
    agentRef: input.agentRef,
    workspace: resolvePath(input.workspace),
    userPrompt: input.userPrompt,
    promptRef: input.promptRef ? resolvePath(input.promptRef) : undefined,
    produces: input.produces,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    pid: null,
    metadata: {
      ...(input.metadata || {}),
      ...(sessionMode ? { inputSessionMode: sessionMode, inputSessionId: input.sessionId } : {}),
    },
    ...(input.parentJobId ? { parentJobId: input.parentJobId } : {}),
  }
  saveJob(job)
  emit('job.queued', {
    jobId: job.id,
    runnerId: job.runnerId,
    taskId: job.metadata?.taskId,
    projectId: job.metadata?.projectId,
  })
  queue.push(id)
  pumpQueue()
  return job
}

export async function submitAndWait(
  input: SubmitJobInput,
  pollMs = 500,
  maxWaitMs = 3_600_000,
): Promise<JobRecord> {
  const job = submitJob(input)
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    const current = loadJob(job.id)
    if (!current) throw new Error('job disappeared')
    if (current.status === 'succeeded' || current.status === 'failed' || current.status === 'cancelled') {
      return current
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  throw new Error('job wait timeout')
}

export function cancelJob(id: string): MutationResult {
  const job = loadJob(id)
  if (!job) return { ok: false, status: 404, error: 'not found' }
  if (job.status === 'succeeded' || job.status === 'failed') {
    return { ok: false, status: 400, error: 'job already finished' }
  }
  // Idempotent: already cancelled → ok without re-emit (avoid duplicate listeners).
  if (job.status === 'cancelled') return { ok: true }

  if (job.pid != null && job.pid > 0) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(job.pid), '/T', '/F'], { stdio: 'ignore' })
      } else {
        process.kill(job.pid, 'SIGTERM')
      }
    } catch {
      /* process may already be gone */
    }
  }

  removeRecoverEntry(id)

  // No OS pid to SIGTERM for providers with no subprocess (AgenticApiProvider
  // subclasses run the model call in-process) — abort the in-flight
  // fetch/SDK call instead so cancelling actually stops the request.
  jobAbortControllers.get(id)?.abort()

  saveJob({ ...job, status: 'cancelled', finishedAt: new Date().toISOString(), pid: null })
  emit('job.cancelled', {
    jobId: job.id,
    taskId: job.metadata?.taskId,
    projectId: job.metadata?.projectId,
  })
  return { ok: true }
}

export interface SubmitApprovalJobInput extends SubmitJobInput {
  /** File (relative to `workspace`) the user will review/approve — e.g. `design.md`. */
  approvalArtifact: string
  /**
   * Selection splice (optional): the agent's proposed content (stdout) is
   * spliced back into only these 1-indexed inclusive lines of the artifact
   * after the job runs. Omit for a whole-file approval.
   */
  spliceRange?: { start: number; end: number }
}

/**
 * Submit a job that runs against a scratch copy of `input.workspace` instead
 * of the real files — nothing lands on disk for real until `approveJob`.
 * Starts a fresh CLI session (`sessionId`) so a later `sendJobFeedback` can
 * resume the exact same conversation.
 */
export function submitApprovalJob(input: SubmitApprovalJobInput): JobRecord {
  const id = crypto.randomUUID()
  const runner = input.runnerId ? getRunner(input.runnerId) : getDefaultRunner()
  const realWorkspace = resolvePath(input.workspace)
  const scratch = copyWorkspaceForApproval(realWorkspace, id)
  const job: JobRecord = {
    id,
    status: 'queued',
    runnerId: runner?.id || input.runnerId || 'unknown',
    agentRef: input.agentRef,
    workspace: scratch,
    userPrompt: input.userPrompt,
    promptRef: input.promptRef ? resolvePath(input.promptRef) : undefined,
    produces: input.produces,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    metadata: input.metadata || {},
    sessionId: crypto.randomUUID(),
    applyTarget: realWorkspace,
    approvalArtifact: input.approvalArtifact,
    ...(input.spliceRange ? { spliceRange: input.spliceRange } : {}),
  }
  saveJob(job)
  queue.push(id)
  pumpQueue()
  return job
}

/**
 * Continue an `awaiting_approval` job's CLI session with follow-up feedback,
 * against the same (still-unapplied) scratch workspace. Returns the new job
 * that will itself reach `awaiting_approval` once it finishes.
 */
export function sendJobFeedback(id: string, feedback: string): MutationResult<{ job: JobRecord }> {
  const parent = loadJob(id)
  if (!parent) return { ok: false, status: 404, error: 'not found' }
  if (parent.status !== 'awaiting_approval') {
    return { ok: false, status: 400, error: 'job is not awaiting approval' }
  }
  if (!parent.sessionId || !parent.applyTarget || !parent.approvalArtifact) {
    return { ok: false, status: 400, error: 'job is not part of an approval flow' }
  }
  const id2 = crypto.randomUUID()
  const job: JobRecord = {
    id: id2,
    status: 'queued',
    runnerId: parent.runnerId,
    agentRef: parent.agentRef,
    workspace: parent.workspace,
    userPrompt: feedback,
    produces: parent.produces,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    metadata: parent.metadata,
    sessionId: parent.sessionId,
    applyTarget: parent.applyTarget,
    approvalArtifact: parent.approvalArtifact,
    parentJobId: parent.id,
    // Carry the splice range so the feedback round splices its result the same way.
    ...(parent.spliceRange ? { spliceRange: parent.spliceRange } : {}),
  }
  saveJob(job)
  queue.push(id2)
  pumpQueue()
  return { ok: true, job }
}

/**
 * Continue the conversation with the agent on a task's most recent finished
 * (non-approval) job, resuming the CLI session recorded in the task's session
 * ledger (`sessionLedger.ts`) — the task-scoped counterpart to
 * `sendJobFeedback` (approval flow, keyed by `jobId`). Runs against the real
 * (non-scratch) workspace, and does not itself advance `current_phase`; the
 * job it submits is tagged `metadata.isChatFeedback` so `runJob()` skips
 * `advancePipelineStepChain` for it (see edge cases in design.md §4.4).
 *
 * If a job for this task is still `queued`/`running`, default (`mode`
 * omitted or `'queue'`) is to record the feedback and return `{ queued: true }`
 * — `runJob` resubmits it automatically once that job finishes. `mode:
 * 'immediate'` instead cancels the active job (only when it's the SAME step
 * being chatted with, or the active job carries no step at all) and resumes
 * its session right away.
 */
export async function sendTaskFeedback(
  taskId: string,
  projectId: string,
  feedback: string,
  opts: { stepId?: string; mode?: 'queue' | 'immediate' } = {},
): Promise<MutationResult<{ job: JobRecord } | { queued: true }>> {
  const active = listJobs(50).find(
    (j) =>
      j.metadata?.taskId === taskId &&
      (j.status === 'queued' || j.status === 'running' || j.status === 'awaiting_recovery'),
  )

  let parent: JobRecord | undefined
  if (active) {
    const activeStepId = stepIdOf(active)
    const sameStep = !activeStepId || !opts.stepId || activeStepId === opts.stepId
    if (opts.mode === 'immediate' && sameStep && cancelJob(active.id).ok) {
      // `cancelJob` just flipped `active` to `'cancelled'` — resume its
      // session directly instead of treating it as "no active job".
      parent = active
    } else {
      const devTeamRoot = typeof active.metadata?.devTeamRoot === 'string' ? active.metadata.devTeamRoot : undefined
      const stillActive = loadJob(active.id)
      if (stillActive && (stillActive.status === 'queued' || stillActive.status === 'running' || stillActive.status === 'awaiting_recovery')) {
        // `queuePendingFeedback` only succeeds for a real dashboard task (one
        // with a `.dev-state` file) — nl-chat's scratch sessions reuse this
        // same function but have none, so they keep the original "busy" error
        // instead of a `queued: true` that would never actually resubmit.
        const queued = devTeamRoot && (await queuePendingFeedback(devTeamRoot, taskId, { feedback, stepId: opts.stepId }))
        if (queued) {
          // Job may have finished between the active check and the write — reclaim and send now.
          const after = loadJob(active.id)
          if (after && after.status !== 'queued' && after.status !== 'running' && after.status !== 'awaiting_recovery') {
            const taken = await takePendingFeedback(devTeamRoot, taskId)
            if (taken) return sendTaskFeedback(taskId, projectId, taken.feedback, { stepId: taken.stepId })
          }
          return { ok: true, queued: true }
        }
        return { ok: false, status: 409, error: 'step already running' }
      }
      // Race: the cancel above lost to the job finishing on its own — fall
      // through and treat it like there was no active job at all.
    }
  }

  if (!parent) {
    const finished = listJobs(200)
      .filter(
        (j) =>
          j.metadata?.taskId === taskId &&
          !j.applyTarget &&
          (j.status === 'succeeded' || j.status === 'failed' || j.status === 'cancelled'),
      )
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    // Chatting from a step's popover must land in THAT step's session, not
    // whatever ran last — prefer the newest finished job of the requested step
    // (its metadata carries the session/workspace the resume plan reuses).
    parent = (opts.stepId ? finished.find((j) => stepIdOf(j) === opts.stepId) : undefined) ?? finished[0]
  }
  if (!parent) return { ok: false, status: 400, error: 'no completed job to give feedback on' }

  const ledger = loadTaskSessionLedger(projectId, taskId)
  const hasOpenSession = ledger.sessions.some((s) => s.status === 'open')

  // The step may have changed agent since `parent` ran (pipeline edited via
  // chat, or advanced past a retry loop) — re-resolve from the pipeline
  // config that's live NOW rather than trusting the old job's `agentRef`.
  let agentRef = parent.agentRef
  const parentStepId = stepIdOf(parent)
  const devTeamRoot = typeof parent.metadata?.devTeamRoot === 'string' ? parent.metadata.devTeamRoot : undefined
  if (parentStepId && devTeamRoot) {
    const pipeline = await loadPipelineConfig(devTeamRoot, taskId)
    const step = (pipeline.steps || []).find((s: any) => s.id === parentStepId)
    if (step?.agent) agentRef = step.agent
  }

  const { isChatFeedback: _isChatFeedback, ...parentMetadata } = parent.metadata || {}
  const job = submitJob({
    runnerId: parent.runnerId === 'unknown' ? undefined : parent.runnerId,
    agentRef,
    workspace: parent.workspace,
    userPrompt: feedback,
    produces: parent.produces,
    // Resume when a ledger session is still open; otherwise start fresh so
    // "new chat session" / close-then-reopen still works after × or +.
    sessionMode: hasOpenSession ? 'resume' : 'new',
    sessionId: hasOpenSession ? parent.sessionId : undefined,
    metadata: {
      ...parentMetadata,
      parentJobId: parent.id,
      isChatFeedback: true,
    },
    parentJobId: parent.id,
  })
  return { ok: true, job }
}

/** Read the real ("before") and scratch ("after") content of an approval job's artifact. */
export function getApprovalDiff(
  id: string,
): MutationResult<{ artifactName: string; before: string; after: string }> {
  const job = loadJob(id)
  if (!job) return { ok: false, status: 404, error: 'not found' }
  if (job.status !== 'awaiting_approval' || !job.applyTarget || !job.approvalArtifact) {
    return { ok: false, status: 400, error: 'job is not awaiting approval' }
  }
  let before = ''
  try {
    before = readTextFileSync(joinPath(job.applyTarget, job.approvalArtifact))
  } catch {
    before = '' // artifact may not exist yet (a brand-new file the agent proposed creating)
  }
  let after: string
  try {
    after = readTextFileSync(joinPath(job.workspace, job.approvalArtifact))
  } catch (err: any) {
    return { ok: false, status: 500, error: `cannot read proposed content: ${err.message}` }
  }
  return { ok: true, artifactName: job.approvalArtifact, before, after }
}

/**
 * Apply an `awaiting_approval` job's scratch content to the real artifact.
 *
 * Scope: this copies back ONLY `approvalArtifact` (the single file the user
 * reviewed), never any other file the agent may have created in the scratch
 * workspace. That is exactly right for a quick action, which always targets one
 * artifact — the scratch copy is then discarded, so stray files never reach the
 * real tree.
 */
export function approveJob(id: string): MutationResult<{ job: JobRecord }> {
  const job = loadJob(id)
  if (!job) return { ok: false, status: 404, error: 'not found' }
  if (job.status !== 'awaiting_approval' || !job.applyTarget || !job.approvalArtifact) {
    return { ok: false, status: 400, error: 'job is not awaiting approval' }
  }
  let content: string
  try {
    content = readTextFileSync(joinPath(job.workspace, job.approvalArtifact))
  } catch (err: any) {
    return { ok: false, status: 500, error: `cannot read proposed content: ${err.message}` }
  }
  const realFile = joinPath(job.applyTarget, job.approvalArtifact)
  try {
    mkdirSync(dirname(realFile), { recursive: true })
    writeTextFileAtomicSync(realFile, content)
  } catch (err: any) {
    return { ok: false, status: 500, error: `cannot apply proposed content: ${err.message}` }
  }
  removeScratchWorkspace(job.workspace)
  const updated = saveJob({ ...job, status: 'succeeded', finishedAt: new Date().toISOString() })
  return { ok: true, job: updated }
}

/** Discard an `awaiting_approval` job — deletes the scratch workspace, applies nothing. */
export function discardJob(id: string): MutationResult<{ job: JobRecord }> {
  const job = loadJob(id)
  if (!job) return { ok: false, status: 404, error: 'not found' }
  if (job.status !== 'awaiting_approval') {
    return { ok: false, status: 400, error: 'job is not awaiting approval' }
  }
  removeScratchWorkspace(job.workspace)
  const updated = saveJob({ ...job, status: 'cancelled', finishedAt: new Date().toISOString() })
  return { ok: true, job: updated }
}

// ── orphan reaper ──────────────────────────────────────────────────────────

/** Best-effort liveness check — `(pid, startedAt)` pair from the job record. */
export function isPidAlive(pid: number | null | undefined): boolean {
  if (pid == null || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Mark orphaned `running` jobs as failed after a server restart — the child
 * process tree is no longer owned by this process.
 */
export function reapOrphanedRunningJobs(): JobRecord[] {
  let files: string[] = []
  try {
    files = readdirSync(jobsDir()).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }

  const reaped: JobRecord[] = []
  for (const f of files) {
    let job: JobRecord
    try {
      job = JSON.parse(readTextFileSync(joinPath(jobsDir(), f)))
    } catch {
      continue
    }
    if (job.status !== 'running') continue
    if (isPidAlive(job.pid)) continue

    const recoverySettings = loadRecoverySettings()
    const entry = recoverySettings.enabled ? loadRecoverEntry(job.id) : null
    if (entry) {
      const updated: JobRecord = {
        ...job,
        status: job.status === 'running' ? 'awaiting_recovery' : job.status,
        pid: null,
      }
      saveJob(updated)
      reaped.push(updated)
      continue
    }

    const attempts = job.attemptCount ?? 0
    if (recoverySettings.enabled && attempts < resolveRecoveryMaxAttempts(recoverySettings)) {
      const nextAttempt = attempts + 1
      const delay = backoffMsFor(nextAttempt, resolveRecoveryBackoffMs(recoverySettings))
      saveRecoverEntry({
        version: 1,
        jobId: job.id,
        kind: 'process_crash',
        attemptCount: nextAttempt,
        resumeAfter: new Date(Date.now() + delay).toISOString(),
        createdAt: new Date().toISOString(),
        lastError: job.error || 'orphaned running job (process no longer alive)',
      })
      const updated: JobRecord = {
        ...job,
        status: 'queued',
        attemptCount: nextAttempt,
        failureKind: 'process_crash',
        pid: null,
        error: job.error || 'orphaned running job (process no longer alive)',
        finishedAt: null,
      }
      saveJob(updated)
      reaped.push(updated)
      continue
    }

    const updated: JobRecord = {
      ...job,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: job.error || 'orphaned running job (process no longer alive)',
      pid: null,
    }
    saveJob(updated)
    reaped.push(updated)
  }
  return reaped
}
