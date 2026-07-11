import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { registryHome } from '../registry.js'
import { getRunner, getDefaultRunner, substituteConfig } from './registry.js'
import { getConnection } from './connections.js'
import { getCredential } from './credentials.js'
import { getProvider } from './providerRegistry.js'
import { resolveAgent } from './agentResolver.js'
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
}

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

  saveJob({ ...job, status: 'running', startedAt: new Date().toISOString(), logPath })

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
    resolvedAgent = await resolveAgent(job.agentRef, { projectRoot, devTeamRoot })
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

  const result = await provider.execute(
    {
      jobId: job.id,
      resolvedAgent,
      userPrompt,
      workspace: job.workspace,
      produces: job.produces,
      timeoutMs: runnerConfig.timeoutMs,
      metadata: { ...job.metadata, logPath },
      // Approval flow: a job continuing a prior approval thread (`parentJobId`
      // set) resumes that same CLI session; the thread's first job instead
      // establishes a fresh one. Both are no-ops for a normal (non-approval) job.
      sessionId: job.sessionId && !job.parentJobId ? job.sessionId : undefined,
      resumeSessionId: job.sessionId && job.parentJobId ? job.sessionId : undefined,
    },
    runnerConfig,
    credential,
  )

  const isApprovalJob = Boolean(job.applyTarget && job.approvalArtifact)
  if (!result.ok && isApprovalJob) removeScratchWorkspace(job.workspace)

  saveJob({
    ...(loadJob(job.id) as JobRecord),
    status: result.ok ? (isApprovalJob ? 'awaiting_approval' : 'succeeded') : 'failed',
    finishedAt: new Date().toISOString(),
    exitCode: result.exitCode,
    error: result.error,
    logPath: result.logPath,
    artifactsFound: result.artifactsFound,
  })
}

export function submitJob(input: SubmitJobInput): JobRecord {
  const id = crypto.randomUUID()
  const runner = input.runnerId ? getRunner(input.runnerId) : getDefaultRunner()
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
    metadata: input.metadata || {},
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
  saveJob({ ...job, status: 'cancelled', finishedAt: new Date().toISOString() })
  return { ok: true }
}

export interface SubmitApprovalJobInput extends SubmitJobInput {
  /** File (relative to `workspace`) the user will review/approve — e.g. `design.md`. */
  approvalArtifact: string
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
