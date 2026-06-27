import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { registryHome } from '../registry.js'
import { getRunner, getDefaultRunner, substituteConfig } from './registry.js'
import { getCredential } from './credentials.js'
import { getProvider } from './providerRegistry.js'
import { resolveAgent } from './agentResolver.js'

function jobsDir() {
  return path.join(registryHome(), 'jobs')
}

function jobFile(id) {
  return path.join(jobsDir(), `${id}.json`)
}

function ensureJobsDir() {
  fs.mkdirSync(jobsDir(), { recursive: true })
}

export function loadJob(id) {
  try {
    const raw = fs.readFileSync(jobFile(id), 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function saveJob(job) {
  ensureJobsDir()
  const file = jobFile(job.id)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(job, null, 2), 'utf8')
  fs.renameSync(tmp, file)
  return job
}

export function listJobs(limit = 20) {
  ensureJobsDir()
  const files = fs.readdirSync(jobsDir()).filter((f) => f.endsWith('.json'))
  const jobs = files
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(jobsDir(), f), 'utf8'))
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  return jobs.slice(0, limit)
}

let running = false
const queue = []

async function processQueue() {
  if (running) return
  running = true
  while (queue.length) {
    const jobId = queue.shift()
    const job = loadJob(jobId)
    if (!job || job.status !== 'queued') continue
    await runJob(job)
  }
  running = false
}

async function runJob(job) {
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

  saveJob({
    ...job,
    status: 'running',
    startedAt: new Date().toISOString(),
    logPath,
  })

  let userPrompt = job.userPrompt || ''
  if (!userPrompt && job.promptRef) {
    try {
      userPrompt = fs.readFileSync(job.promptRef, 'utf8')
    } catch (err) {
      saveJob({
        ...loadJob(job.id),
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: `cannot read prompt: ${err.message}`,
      })
      return
    }
  }

  const projectRoot = job.metadata?.projectRoot || path.dirname(job.workspace)
  const devTeamRoot = job.metadata?.devTeamRoot || job.workspace

  let resolvedAgent
  try {
    resolvedAgent = await resolveAgent(job.agentRef, { projectRoot, devTeamRoot })
  } catch (err) {
    saveJob({
      ...loadJob(job.id),
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: String(err.message || err),
    })
    return
  }

  const runnerConfig = substituteConfig(runner.config, { projectRoot })

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

  saveJob({
    ...loadJob(job.id),
    status: result.ok ? 'succeeded' : 'failed',
    finishedAt: new Date().toISOString(),
    exitCode: result.exitCode,
    error: result.error,
    logPath: result.logPath,
    artifactsFound: result.artifactsFound,
  })
}

/**
 * @param {object} input
 * @param {string} [input.runnerId]
 * @param {string} input.agentRef
 * @param {string} input.workspace
 * @param {string} [input.userPrompt]
 * @param {string} [input.promptRef]
 * @param {string[]} [input.produces]
 * @param {Record<string, unknown>} [input.metadata]
 */
export function submitJob(input) {
  const id = crypto.randomUUID()
  const runner = input.runnerId ? getRunner(input.runnerId) : getDefaultRunner()
  const job = {
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

export async function submitAndWait(input, pollMs = 500, maxWaitMs = 3_600_000) {
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

export function cancelJob(id) {
  const job = loadJob(id)
  if (!job) return { ok: false, status: 404, error: 'not found' }
  if (job.status === 'succeeded' || job.status === 'failed') {
    return { ok: false, status: 400, error: 'job already finished' }
  }
  saveJob({ ...job, status: 'cancelled', finishedAt: new Date().toISOString() })
  return { ok: true }
}
