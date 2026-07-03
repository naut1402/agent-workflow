import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { registryHome, get as getProject } from '../registry.js'
import { getRunner, getDefaultRunner, substituteConfig } from './registry.js'
import { getCredential } from './credentials.js'
import { getProvider } from './providerRegistry.js'
import { resolveAgent } from './agentResolver.js'
import { pullArtifacts } from '../workspace/sshSync.js'
import type { JobRecord, MutationResult } from './types.js'

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
    .filter((j): j is JobRecord => Boolean(j))
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

  const credential = getCredential(runner.credentialId)
  if (!credential) {
    saveJob({
      ...job,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: `credential not found: ${runner.credentialId}`,
    })
    return
  }

  const provider = getProvider(runner.provider)
  if (!provider) {
    saveJob({
      ...job,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: `unknown provider: ${runner.provider}`,
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

  const runnerConfig = substituteConfig(runner.config, { projectRoot }) as Record<string, any>

  const result = await provider.execute(
    {
      jobId: job.id,
      resolvedAgent,
      userPrompt,
      workspace: job.workspace,
      produces: job.produces,
      timeoutMs: runnerConfig.timeoutMs,
      metadata: { logPath },
    },
    runnerConfig,
    credential,
  )

  let pullResult: Awaited<ReturnType<typeof pullArtifacts>> | null = null
  if (runner.provider === 'claude-code-ssh') {
    const projectId = job.metadata?.projectId as string | undefined
    if (projectId) {
      const project = getProject(projectId)
      if (project?.kind === 'ssh' && project.remote) {
        const sshRunner = getRunner(project.remote.runnerId) ?? runner
        pullResult = await pullArtifacts({ project, runner: sshRunner, credential })
        if ('error' in pullResult && pullResult.error) {
          console.warn(`[jobQueue] pullArtifacts failed for ${projectId}:`, pullResult.error)
        }
      }
    }
  }

  saveJob({
    ...(loadJob(job.id) as JobRecord),
    status: result.ok ? 'succeeded' : 'failed',
    finishedAt: new Date().toISOString(),
    exitCode: result.exitCode,
    error: result.error,
    logPath: result.logPath,
    artifactsFound: result.artifactsFound,
    metadata: { ...job.metadata, lastPull: pullResult },
  })
}

export function submitJob(input: SubmitJobInput): JobRecord {
  const id = crypto.randomUUID()
  const runner = input.runnerId ? getRunner(input.runnerId) : getDefaultRunner()
  const preserveWorkspace = Boolean(input.metadata?.remoteDevTeamRoot)
  const job: JobRecord = {
    id,
    status: 'queued',
    runnerId: runner?.id || input.runnerId || 'unknown',
    agentRef: input.agentRef,
    workspace: preserveWorkspace ? input.workspace : path.resolve(input.workspace),
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
