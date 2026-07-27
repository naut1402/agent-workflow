import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import os from 'node:os'
import { registryHome } from '../registry.js'
import { getRunner, getDefaultRunner, substituteConfig } from './registry.js'
import { getConnection } from './connections.js'
import { getCredential } from './credentials.js'
import { getProvider } from './providerRegistry.js'
import { resolveAgent } from './agentResolver.js'
import { reapOrphanedRunningJobs } from './pidReaper.js'
import { mintSessionId } from './sessionCapture.js'
import { recordSessionUsage, resolveSessionPlan, type SessionMode } from './sessionLedger.js'
import type { Connection, CredentialProfile, JobRecord, MutationResult } from './types.js'

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
}

// Reap orphaned running jobs once when the module loads (server restart).
reapOrphanedRunningJobs()

function jobsDir(): string {
  return path.join(registryHome(), 'jobs')
}

function jobFile(id: string): string {
  return path.join(jobsDir(), `${id}.json`)
}

function ensureJobsDir(): void {
  fs.mkdirSync(jobsDir(), { recursive: true })
}

// ── Approval flow (see JobRecord's sessionId/applyTarget/approvalArtifact/
// parentJobId doc comments in types.ts) ─────────────────────────────────────
// A `require_approval` quick action runs against a throwaway copy of the task
// workspace under the dashboard's own registry home — never the real project
// tree — so nothing is written to the user's files until they explicitly
// approve. `~/.dev-team-dashboard/proposals/<jobId>/` mirrors the `jobs/`
// directory's placement (outside any git-tracked tree).

function proposalsDir(): string {
  return path.join(registryHome(), 'proposals')
}

function scratchWorkspacePath(jobId: string): string {
  return path.join(proposalsDir(), jobId)
}

function copyWorkspaceForApproval(realWorkspace: string, jobId: string): string {
  const scratch = scratchWorkspacePath(jobId)
  fs.mkdirSync(path.dirname(scratch), { recursive: true })
  fs.cpSync(realWorkspace, scratch, { recursive: true })
  return scratch
}

function removeScratchWorkspace(scratchPath: string): void {
  try {
    fs.rmSync(scratchPath, { recursive: true, force: true })
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
  const scratchArtifact = path.join(job.workspace, job.approvalArtifact!)
  if (job.spliceRange) {
    let base = ''
    try {
      base = fs.readFileSync(path.join(job.applyTarget!, job.approvalArtifact!), 'utf8')
    } catch {
      base = '' // real artifact may not exist yet
    }
    const spliced = spliceLines(base, job.spliceRange.start, job.spliceRange.end, proposed)
    fs.writeFileSync(scratchArtifact, spliced, 'utf8')
  } else if (proposed) {
    fs.writeFileSync(scratchArtifact, proposed, 'utf8')
  }
  // else: whole-file job with no stdout — keep whatever the agent wrote.
}

export function loadJob(id: string): JobRecord | null {
  try {
    return JSON.parse(fs.readFileSync(jobFile(id), 'utf8'))
  } catch {
    return null
  }
}

function saveJob(job: JobRecord): JobRecord {
  ensureJobsDir()
  const file = jobFile(job.id)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(job, null, 2), 'utf8')
  fs.renameSync(tmp, file)
  return job
}

export function listJobs(limit = 20): JobRecord[] {
  ensureJobsDir()
  const files = fs.readdirSync(jobsDir()).filter((f) => f.endsWith('.json'))
  const jobs = files
    .map((f): JobRecord | null => {
      try {
        return JSON.parse(fs.readFileSync(path.join(jobsDir(), f), 'utf8'))
      } catch {
        return null
      }
    })
    .filter((j): j is JobRecord => Boolean(j?.id))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  return jobs.slice(0, limit)
}

let running = false
const queue: string[] = []

async function processQueue(): Promise<void> {
  if (running) return
  running = true
  while (queue.length) {
    const jobId = queue.shift()!
    const job = loadJob(jobId)
    if (!job || job.status !== 'queued') continue
    await runJob(job)
  }
  running = false
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
    return
  }

  const connection = getConnection(runner.connectionId)
  if (!connection) {
    saveJob({
      ...job,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: `connection not found: ${runner.connectionId}`,
    })
    return
  }

  const credential = credentialForConnection(connection)
  if (!credential) {
    saveJob({
      ...job,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: `credential not found for connection: ${runner.connectionId}`,
    })
    return
  }

  const provider = getProvider(connection.providerId)
  if (!provider) {
    saveJob({
      ...job,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: `unknown provider: ${connection.providerId}`,
    })
    return
  }

  const logPath = path.join(jobsDir(), `${job.id}.log`)
  try {
    fs.writeFileSync(logPath, '', 'utf8')
  } catch {
    /* ignore */
  }

  saveJob({ ...job, status: 'running', startedAt: new Date().toISOString(), logPath, pid: null })

  let userPrompt = job.userPrompt || ''
  if (!userPrompt && job.promptRef) {
    try {
      userPrompt = fs.readFileSync(job.promptRef, 'utf8')
    } catch (err: any) {
      saveJob({
        ...(loadJob(job.id) as JobRecord),
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: `cannot read prompt: ${err.message}`,
      })
      return
    }
  }

  const projectRoot = (job.metadata?.projectRoot as string) || path.dirname(job.workspace)
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
    saveJob({
      ...(loadJob(job.id) as JobRecord),
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: String(err.message || err),
    })
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
      stepId: typeof job.metadata?.stepId === 'string' ? job.metadata.stepId : undefined,
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
        stepId: typeof job.metadata?.stepId === 'string' ? job.metadata.stepId : undefined,
        forceNew: true,
        staleReason: sessionStaleReason,
      })
    }
  }

  const onStart = (info: { pid: number | null }) => {
    const current = loadJob(job.id)
    if (!current || current.status !== 'running') return
    saveJob({ ...current, pid: info.pid ?? null })
  }

  const result = await provider.execute(
    {
      jobId: job.id,
      resolvedAgent,
      userPrompt,
      workspace: job.workspace,
      produces: job.produces,
      timeoutMs: runnerConfig.timeoutMs,
      metadata: { ...job.metadata, logPath },
      sessionId: execSessionId,
      resumeSessionId: execResumeSessionId,
    },
    runnerConfig,
    credential,
    undefined,
    onStart,
  )

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
      stepId: typeof job.metadata?.stepId === 'string' ? job.metadata.stepId : undefined,
    })
  }

  const isApprovalJob = Boolean(job.applyTarget && job.approvalArtifact)
  if (!result.ok && isApprovalJob) removeScratchWorkspace(job.workspace)

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
      return
    }
  }

  saveJob({
    ...(loadJob(job.id) as JobRecord),
    status: result.ok ? (isApprovalJob ? 'awaiting_approval' : 'succeeded') : 'failed',
    finishedAt: new Date().toISOString(),
    exitCode: result.exitCode,
    error: result.error,
    logPath: result.logPath,
    artifactsFound: result.artifactsFound,
    pid: null,
    ...(capturedSessionId && !isApprovalJob ? { sessionId: capturedSessionId } : {}),
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
    workspace: path.resolve(input.workspace),
    userPrompt: input.userPrompt,
    promptRef: input.promptRef ? path.resolve(input.promptRef) : undefined,
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
  }
  saveJob(job)
  queue.push(id)
  processQueue().catch((err) => {
    console.error('[jobQueue]', err)
  })
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

  saveJob({ ...job, status: 'cancelled', finishedAt: new Date().toISOString(), pid: null })
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
  const realWorkspace = path.resolve(input.workspace)
  const scratch = copyWorkspaceForApproval(realWorkspace, id)
  const job: JobRecord = {
    id,
    status: 'queued',
    runnerId: runner?.id || input.runnerId || 'unknown',
    agentRef: input.agentRef,
    workspace: scratch,
    userPrompt: input.userPrompt,
    promptRef: input.promptRef ? path.resolve(input.promptRef) : undefined,
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
  processQueue().catch((err) => {
    console.error('[jobQueue]', err)
  })
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
  processQueue().catch((err) => {
    console.error('[jobQueue]', err)
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
    before = fs.readFileSync(path.join(job.applyTarget, job.approvalArtifact), 'utf8')
  } catch {
    before = '' // artifact may not exist yet (a brand-new file the agent proposed creating)
  }
  let after: string
  try {
    after = fs.readFileSync(path.join(job.workspace, job.approvalArtifact), 'utf8')
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
    content = fs.readFileSync(path.join(job.workspace, job.approvalArtifact), 'utf8')
  } catch (err: any) {
    return { ok: false, status: 500, error: `cannot read proposed content: ${err.message}` }
  }
  const realFile = path.join(job.applyTarget, job.approvalArtifact)
  try {
    fs.mkdirSync(path.dirname(realFile), { recursive: true })
    const tmp = `${realFile}.tmp`
    fs.writeFileSync(tmp, content, 'utf8')
    fs.renameSync(tmp, realFile)
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
