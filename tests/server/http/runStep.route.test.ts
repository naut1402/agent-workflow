import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../server/http/app.js'
import type { RegistryContext } from '../../../server/registry.js'
import { loadJob, listJobs, registerProvider, upsertConnection, upsertRunner } from '../../../server/runners/index.js'
import type { ExecuteRequest, ExecuteResult, RunnerProvider } from '../../../server/runners/types.js'

// Route-level contract for POST /api/tasks/:id/run-step — clicking a pipeline
// node to run the task's current step (and, with `targetStepId`, keep
// chaining across gate-less steps). Driven via Hono's app.request, same style
// as jobApproval.route.test.ts. A stub provider "succeeds" instantly so the
// job-queue's chain-on-success hook (jobQueue.ts advancePipelineStepChain)
// runs synchronously enough for `settle()` polling to observe it.

const PROVIDER_ID = 'stub-run-step-route'

let resolveGate: (() => void) | null = null
let gated = false

const stubProvider: RunnerProvider = {
  providerId: PROVIDER_ID,
  validateRunnerConfig: () => ({ ok: true, errors: [] }),
  validateCredential: () => ({ ok: true, errors: [] }),
  capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }),
  async execute(_req: ExecuteRequest): Promise<ExecuteResult> {
    if (gated) {
      await new Promise<void>((r) => {
        resolveGate = r
      })
    }
    return { ok: true, exitCode: 0, durationMs: 1 }
  },
}

let root: string
let app: ReturnType<typeof createApp>
const savedEnv = { ...process.env }

function fakeCtx(): RegistryContext {
  return {
    defaultRoot: root,
    resolveProjectRoot: (id: string | null) => (id ? null : root),
    registry: {
      list: () => ({ projects: [], defaultId: null }),
      get: () => null,
      add: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      remove: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      validateProjectPath: (() => ({ ok: false, status: 400, error: 'stub' })) as any,
      seedDefault: () => null,
    },
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function settle(id: string) {
  for (let i = 0; i < 400; i++) {
    const j = loadJob(id)
    if (j && j.status !== 'queued' && j.status !== 'running') return j
    await sleep(5)
  }
  throw new Error(`job ${id} never settled (status=${loadJob(id)?.status})`)
}

async function waitForPhase(taskId: string, predicate: (phase: string | null) => boolean, tries = 400) {
  const stateFile = path.join(root, '.dev-state', `${taskId}.json`)
  for (let i = 0; i < tries; i++) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    if (predicate(state.current_phase ?? null)) return state
    await sleep(5)
  }
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  throw new Error(`current_phase never matched (last=${state.current_phase})`)
}

function seedTask(taskId: string, state: Record<string, unknown>, requestBody = 'do the thing') {
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tasks', taskId), { recursive: true })
  fs.writeFileSync(
    path.join(root, '.dev-state', `${taskId}.json`),
    JSON.stringify({ task_id: taskId, ...state }, null, 2),
    'utf8',
  )
  fs.writeFileSync(path.join(root, 'tasks', taskId, 'request.md'), requestBody, 'utf8')
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-run-step-route-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = path.join(root, '.home')
  registerProvider(stubProvider)
  upsertConnection({ id: 'stub-conn-run-step', kind: 'local-console', providerId: PROVIDER_ID, cliPath: 'stub' })
  upsertRunner({ id: 'stub-runner-run-step', connectionId: 'stub-conn-run-step', config: {} })
  fs.writeFileSync(
    path.join(root, 'pipeline.yaml'),
    [
      'version: 1',
      'steps:',
      "  - id: implementer",
      "    agent: ' '",
      "  - id: reviewer",
      "    agent: ' '",
      "    hitl: { mode: manual, gate_id: hitl-3 }",
      "  - id: pr-creator",
      "    agent: ' '",
    ].join('\n'),
    'utf8',
  )
  app = createApp(fakeCtx())
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(root, { recursive: true, force: true })
})
afterEach(() => {
  gated = false
  resolveGate = null
})

describe('POST /api/tasks/:id/run-step', () => {
  test('201: submits a job for the current step and advances phase past a gate-less step', async () => {
    seedTask('R1', { current_phase: 'implementer' })
    const res = await app.request('/api/tasks/R1/run-step', {
      method: 'POST',
      body: JSON.stringify({ runnerId: 'stub-runner-run-step' }),
    })
    expect(res.status).toBe(201)
    const { job } = await res.json()
    expect(job.metadata.pipelineStepId).toBe('implementer')
    expect(job.metadata.inputSessionMode).toBe('new')
    await settle(job.id)
    await waitForPhase('R1', (p) => p === 'reviewer')
  })

  test('chains across gate-less steps but stops once it hits a HITL-gated step', async () => {
    seedTask('R2', { current_phase: 'implementer' })
    const res = await app.request('/api/tasks/R2/run-step', {
      method: 'POST',
      body: JSON.stringify({ runnerId: 'stub-runner-run-step', targetStepId: 'pr-creator' }),
    })
    expect(res.status).toBe(201)
    const { job } = await res.json()
    await settle(job.id)
    // implementer → reviewer chained automatically; reviewer has a gate so the
    // chain must not reach pr-creator on its own — instead its gate opens.
    await waitForPhase('R2', (p) => p === 'reviewer')
    await sleep(50)
    const state = JSON.parse(fs.readFileSync(path.join(root, '.dev-state', 'R2.json'), 'utf8'))
    expect(state.current_phase).toBe('reviewer')
    expect(state.hitl_pending).toBe('hitl-3')
  })

  test('chains all the way to the target when no gate is in between', async () => {
    seedTask('R3', { current_phase: 'implementer' })
    // Rewrite pipeline for this task only: implementer → pr-creator, no gate.
    fs.mkdirSync(path.join(root, 'tasks', 'R3'), { recursive: true })
    fs.writeFileSync(
      path.join(root, 'tasks', 'R3', 'pipeline.yaml'),
      [
        'steps_replace: true',
        'steps:',
        "  - id: implementer",
        "    agent: ' '",
        "  - id: pr-creator",
        "    agent: ' '",
      ].join('\n'),
      'utf8',
    )
    const res = await app.request('/api/tasks/R3/run-step', {
      method: 'POST',
      body: JSON.stringify({ runnerId: 'stub-runner-run-step', targetStepId: 'pr-creator' }),
    })
    expect(res.status).toBe(201)
    const { job } = await res.json()
    await settle(job.id)
    await waitForPhase('R3', (p) => p === 'completed')
  })

  test('400 when the task is waiting on a HITL gate', async () => {
    seedTask('R4', { current_phase: 'reviewer', hitl_pending: 'hitl-3' })
    const res = await app.request('/api/tasks/R4/run-step', { method: 'POST', body: JSON.stringify({}) })
    expect(res.status).toBe(400)
  })

  test('404 when request.md is missing', async () => {
    fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
    fs.writeFileSync(
      path.join(root, '.dev-state', 'R5.json'),
      JSON.stringify({ task_id: 'R5', current_phase: 'implementer' }),
      'utf8',
    )
    const res = await app.request('/api/tasks/R5/run-step', { method: 'POST', body: JSON.stringify({}) })
    expect(res.status).toBe(404)
  })

  test('409 when a job is already running for the task', async () => {
    gated = true
    seedTask('R6', { current_phase: 'implementer' })
    const first = await app.request('/api/tasks/R6/run-step', {
      method: 'POST',
      body: JSON.stringify({ runnerId: 'stub-runner-run-step' }),
    })
    expect(first.status).toBe(201)
    const { job: firstJob } = await first.json()
    for (let i = 0; i < 200 && loadJob(firstJob.id)?.status !== 'running'; i++) await sleep(5)
    expect(loadJob(firstJob.id)?.status).toBe('running')

    const second = await app.request('/api/tasks/R6/run-step', {
      method: 'POST',
      body: JSON.stringify({ runnerId: 'stub-runner-run-step' }),
    })
    expect(second.status).toBe(409)

    gated = false
    resolveGate?.()
    await settle(firstJob.id)
  })

  test('tags inputSessionMode new so each step starts a fresh CLI session', async () => {
    seedTask('R7', { current_phase: 'implementer' })
    const res = await app.request('/api/tasks/R7/run-step', {
      method: 'POST',
      body: JSON.stringify({ runnerId: 'stub-runner-run-step' }),
    })
    expect(res.status).toBe(201)
    const { job } = await res.json()
    expect(job.metadata.inputSessionMode).toBe('new')
    await settle(job.id)
  })

  test('advances current_phase before marking the job succeeded (no stale-phase window)', async () => {
    seedTask('R8', { current_phase: 'implementer' })
    const res = await app.request('/api/tasks/R8/run-step', {
      method: 'POST',
      body: JSON.stringify({ runnerId: 'stub-runner-run-step' }),
    })
    expect(res.status).toBe(201)
    const { job } = await res.json()
    const stateFile = path.join(root, '.dev-state', 'R8.json')
    let sawSucceeded = false
    for (let i = 0; i < 400; i++) {
      const j = loadJob(job.id)
      if (!j) {
        await sleep(5)
        continue
      }
      if (j.status === 'succeeded') {
        sawSucceeded = true
        const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
        // Phase must already have moved by the time status is succeeded.
        expect(state.current_phase).not.toBe('implementer')
        expect(state.current_phase).toBe('reviewer')
        break
      }
      await sleep(5)
    }
    expect(sawSucceeded).toBe(true)
  })

  test('heals a stuck current_phase when a prior succeeded job already ran that step', async () => {
    seedTask('R9', { current_phase: 'implementer' })
    // Simulate crash-between-succeed-and-advance: job finished for
    // implementer but current_phase never moved.
    const stuckJobId = crypto.randomUUID()
    const jobsDir = path.join(root, '.home', 'jobs')
    fs.mkdirSync(jobsDir, { recursive: true })
    fs.writeFileSync(
      path.join(jobsDir, `${stuckJobId}.json`),
      JSON.stringify({
        id: stuckJobId,
        status: 'succeeded',
        runnerId: 'stub-runner-run-step',
        agentRef: ' ',
        workspace: path.join(root, 'tasks', 'R9'),
        userPrompt: 'do the thing',
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        exitCode: 0,
        pid: null,
        metadata: {
          taskId: 'R9',
          pipelineStepId: 'implementer',
          devTeamRoot: root,
        },
      }),
      'utf8',
    )

    const res = await app.request('/api/tasks/R9/run-step', {
      method: 'POST',
      body: JSON.stringify({ runnerId: 'stub-runner-run-step', targetStepId: 'pr-creator' }),
    })
    expect(res.status).toBe(201)
    const { job } = await res.json()
    // Heal advanced implementer → reviewer; new job must start at reviewer
    // (gated) rather than re-running implementer.
    expect(job.metadata.pipelineStepId).toBe('reviewer')
    await settle(job.id)
    const state = JSON.parse(fs.readFileSync(path.join(root, '.dev-state', 'R9.json'), 'utf8'))
    expect(state.current_phase).toBe('reviewer')
    expect(state.hitl_pending).toBe('hitl-3')
  })

  test('chained step jobs also use inputSessionMode new', async () => {
    seedTask('R10', { current_phase: 'implementer' })
    fs.mkdirSync(path.join(root, 'tasks', 'R10'), { recursive: true })
    fs.writeFileSync(
      path.join(root, 'tasks', 'R10', 'pipeline.yaml'),
      [
        'steps_replace: true',
        'steps:',
        "  - id: implementer",
        "    agent: ' '",
        "  - id: pr-creator",
        "    agent: ' '",
      ].join('\n'),
      'utf8',
    )
    const res = await app.request('/api/tasks/R10/run-step', {
      method: 'POST',
      body: JSON.stringify({ runnerId: 'stub-runner-run-step', targetStepId: 'pr-creator' }),
    })
    expect(res.status).toBe(201)
    const { job } = await res.json()
    expect(job.metadata.inputSessionMode).toBe('new')
    await settle(job.id)
    await waitForPhase('R10', (p) => p === 'completed')
    // Find the chained pr-creator job and assert it also started fresh.
    const chained = listJobs(50).find(
      (j) => j.metadata?.taskId === 'R10' && j.metadata?.pipelineStepId === 'pr-creator',
    )
    expect(chained).toBeTruthy()
    expect(chained?.metadata?.inputSessionMode).toBe('new')
  })
})

describe('POST /api/tasks with run:true', () => {
  test('tags pipelineStepId so a successful first-step job advances current_phase', async () => {
    const res = await app.request('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        taskId: 'CREATE1',
        source: 'prompt',
        prompt: 'do the thing',
        run: true,
        runnerId: 'stub-runner-run-step',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.job?.metadata?.pipelineStepId).toBe('implementer')
    expect(body.job?.metadata?.createTaskRun).toBe(true)
    await settle(body.job.id)
    // Root pipeline's first step (implementer) is gate-less → advance to reviewer.
    await waitForPhase('CREATE1', (p) => p === 'reviewer')
  })
})
