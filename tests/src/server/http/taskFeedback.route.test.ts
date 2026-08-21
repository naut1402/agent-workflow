import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/api/apiServer.js'
import type { RegistryContext } from '../../../../src/core/http/types.js'
import { listJobs, loadJob, loadTaskSessionLedger, registerProvider, upsertConnection, upsertRunner } from '../../../../src/features/runner/business/index.js'
import type { ExecuteRequest, ExecuteResult, RunnerProvider } from '../../../../src/features/runner/business/types.js'

// Route-level contract for POST /api/tasks/:id/feedback — task-scoped chat
// resume (F0011), the counterpart to POST /api/jobs/:id/feedback (approval
// flow, see jobApproval.route.test.ts) but keyed by taskId. Also covers the
// run-step wiring (`sessionMode: 'resume'`) that makes this reachable beyond
// the very first step. Driven via Hono's app.request, same style as
// runStep.route.test.ts.

const PROVIDER_ID = 'stub-task-feedback-route'

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
let app: Awaited<ReturnType<typeof createApp>>
const savedEnv = { ...process.env }
const PROJECT_ID = 'proj-task-feedback'

function fakeCtx(): RegistryContext {
  return {
    defaultRoot: root,
    // Unlike the other route tests' stub (any explicit id → null), this one
    // also resolves the known PROJECT_ID so `?project=` requests can exercise
    // the session-ledger path, which requires a real projectId (see
    // server/runners/sessionLedger.ts / jobQueue.ts runJob).
    resolveProjectRoot: (id: string | null) => (id && id !== PROJECT_ID ? null : root),
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

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-task-feedback-route-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = path.join(root, '.home')
  registerProvider(stubProvider)
  upsertConnection({ id: 'stub-conn-tf-route', kind: 'local-console', providerId: PROVIDER_ID, cliPath: 'stub' })
  upsertRunner({ id: 'stub-runner-tf-route', connectionId: 'stub-conn-tf-route', config: {} })
  fs.writeFileSync(
    path.join(root, 'pipeline.yaml'),
    ['version: 1', 'steps:', "  - id: implementer", "    agent: ' '", "  - id: reviewer", "    agent: ' '"].join('\n'),
    'utf8',
  )
  app = await createApp(fakeCtx())
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(root, { recursive: true, force: true })
})
afterEach(() => {
  gated = false
  resolveGate = null
})

async function runStep(taskId: string, body: Record<string, unknown> = {}) {
  return app.request(`/api/tasks/${taskId}/run-step?project=${PROJECT_ID}`, {
    method: 'POST',
    body: JSON.stringify({ runnerId: 'stub-runner-tf-route', ...body }),
  })
}

describe('run-step wiring: sessionMode resume', () => {
  test('a chain through gate-less steps leaves exactly one open ledger entry', async () => {
    seedTask('W1', { current_phase: 'implementer' })
    const first = await runStep('W1')
    expect(first.status).toBe(201)
    const { job: job1 } = await first.json()
    await settle(job1.id)
    // implementer -> reviewer now chains automatically from this single call
    // (B202608_1902) — a second run-step call is no longer how the pipeline
    // reaches `reviewer`'s own session.
    await waitForPhase('W1', (p) => p === 'completed')

    const ledger = loadTaskSessionLedger(PROJECT_ID, 'W1')
    const openEntries = ledger.sessions.filter((s) => s.status === 'open')
    expect(openEntries.length).toBe(1)
  })
})

describe('POST /api/tasks/:id/feedback', () => {
  test('201: resumes the session on the task most recent finished job', async () => {
    seedTask('F1', { current_phase: 'implementer' })
    const stepRes = await runStep('F1')
    expect(stepRes.status).toBe(201)
    const { job } = await stepRes.json()
    await settle(job.id)
    // implementer -> reviewer chains automatically (B202608_1902) — the most
    // recent finished job is now reviewer's, not the implementer job returned
    // above.
    await waitForPhase('F1', (p) => p === 'completed')
    const reviewerJob = listJobs(50).find(
      (j) => j.metadata?.taskId === 'F1' && j.metadata?.pipelineStepId === 'reviewer',
    )
    expect(reviewerJob).toBeTruthy()

    const res = await app.request(`/api/tasks/F1/feedback?project=${PROJECT_ID}`, {
      method: 'POST',
      body: JSON.stringify({ feedback: 'please clarify' }),
    })
    expect(res.status).toBe(201)
    const { job: child } = await res.json()
    expect(child.parentJobId).toBe(reviewerJob!.id)
    expect(child.metadata.isChatFeedback).toBe(true)
    await settle(child.id)
  })

  test('400 on empty feedback body', async () => {
    seedTask('F2', { current_phase: 'implementer' })
    const res = await app.request(`/api/tasks/F2/feedback?project=${PROJECT_ID}`, {
      method: 'POST',
      body: JSON.stringify({ feedback: '' }),
    })
    expect(res.status).toBe(400)
  })

  test('starts a new session when the task has no open ledger entry', async () => {
    seedTask('F3', { current_phase: 'implementer' })
    // run-step without a `project` query param → projectId stays null so
    // runJob() never writes to the session ledger — the finished job exists
    // but there is nothing to resume; feedback opens a fresh session.
    const stepRes = await app.request('/api/tasks/F3/run-step', {
      method: 'POST',
      body: JSON.stringify({ runnerId: 'stub-runner-tf-route' }),
    })
    expect(stepRes.status).toBe(201)
    const { job } = await stepRes.json()
    await settle(job.id)

    const res = await app.request('/api/tasks/F3/feedback', {
      method: 'POST',
      body: JSON.stringify({ feedback: 'hi' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.job?.metadata?.inputSessionMode).toBe('new')
  })

  test('404 for an unknown task', async () => {
    const res = await app.request(`/api/tasks/NOPE/feedback?project=${PROJECT_ID}`, {
      method: 'POST',
      body: JSON.stringify({ feedback: 'hi' }),
    })
    expect(res.status).toBe(404)
  })

  test('default (queue) mode while a job is running: 201 queued, not 409', async () => {
    gated = true
    seedTask('F4', { current_phase: 'implementer' })
    const stepRes = await runStep('F4')
    expect(stepRes.status).toBe(201)
    const { job } = await stepRes.json()
    for (let i = 0; i < 200 && loadJob(job.id)?.status !== 'running'; i++) await sleep(5)
    expect(loadJob(job.id)?.status).toBe('running')

    const res = await app.request(`/api/tasks/F4/feedback?project=${PROJECT_ID}`, {
      method: 'POST',
      body: JSON.stringify({ feedback: 'hi' }),
    })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ queued: true })

    gated = false
    resolveGate?.()
    await settle(job.id)
  })

  test('queued feedback is resubmitted automatically once the running job finishes', async () => {
    gated = true
    seedTask('F5', { current_phase: 'implementer' })
    const stepRes = await runStep('F5')
    const { job } = await stepRes.json()
    for (let i = 0; i < 200 && loadJob(job.id)?.status !== 'running'; i++) await sleep(5)

    const queueRes = await app.request(`/api/tasks/F5/feedback?project=${PROJECT_ID}`, {
      method: 'POST',
      body: JSON.stringify({ feedback: 'please clarify' }),
    })
    expect(queueRes.status).toBe(201)

    gated = false
    resolveGate?.()
    const finished = await settle(job.id)
    expect(finished.status).toBe('succeeded')

    // The resubmit fires from inside runJob's tail. With implementer -> reviewer
    // now chaining automatically (B202608_1902), the queued feedback may find
    // the auto-chained reviewer job still active and re-queue itself once more
    // before finally resubmitting once that job also finishes — so match by
    // content/taskId rather than assuming implementer is still the parent.
    let child: any = null
    for (let i = 0; i < 200 && !child; i++) {
      const jobs = fs
        .readdirSync(path.join(process.env.DEV_TEAM_DASHBOARD_HOME as string, 'jobs'))
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(fs.readFileSync(path.join(process.env.DEV_TEAM_DASHBOARD_HOME as string, 'jobs', f), 'utf8')))
      child = jobs.find(
        (j) => j.metadata?.taskId === 'F5' && j.metadata?.isChatFeedback && j.userPrompt === 'please clarify',
      )
      if (!child) await sleep(5)
    }
    expect(child).toBeTruthy()
    expect(child.userPrompt).toBe('please clarify')
    await settle(child.id)
  })

  test("immediate mode on the SAME step cancels the running job and resumes now", async () => {
    gated = true
    seedTask('F6', { current_phase: 'implementer' })
    const stepRes = await runStep('F6')
    const { job } = await stepRes.json()
    for (let i = 0; i < 200 && loadJob(job.id)?.status !== 'running'; i++) await sleep(5)

    const res = await app.request(`/api/tasks/F6/feedback?project=${PROJECT_ID}`, {
      method: 'POST',
      body: JSON.stringify({ feedback: 'stop, do X instead', stepId: 'implementer', mode: 'immediate' }),
    })
    expect(res.status).toBe(201)
    const { job: child } = await res.json()
    expect(child.parentJobId).toBe(job.id)

    expect(loadJob(job.id)?.status).toBe('cancelled')

    gated = false
    resolveGate?.()
    await settle(child.id)
  })

  test('immediate mode targeting a DIFFERENT step falls back to queueing, does not cancel', async () => {
    gated = true
    seedTask('F7', { current_phase: 'implementer' })
    const stepRes = await runStep('F7')
    const { job } = await stepRes.json()
    for (let i = 0; i < 200 && loadJob(job.id)?.status !== 'running'; i++) await sleep(5)

    const res = await app.request(`/api/tasks/F7/feedback?project=${PROJECT_ID}`, {
      method: 'POST',
      body: JSON.stringify({ feedback: 'hi', stepId: 'reviewer', mode: 'immediate' }),
    })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ queued: true })
    expect(loadJob(job.id)?.status).toBe('running')

    gated = false
    resolveGate?.()
    await settle(job.id)
  })
})

// GET /api/tasks/:id/chat — the runner conversation the chat window replays.
// The transcript itself is the CLI's file (see sessionTranscript.test.ts); here
// only the route contract and the block reasons the UI depends on are checked.
describe('GET /api/tasks/:id/chat', () => {
  test('400 for an invalid task id', async () => {
    const res = await app.request(`/api/tasks/..%2Fetc/chat?project=${PROJECT_ID}`)
    expect(res.status).toBe(400)
  })

  test('blockedReason noCompletedJob before anything has run', async () => {
    seedTask('C1', { current_phase: 'implementer' })
    const res = await app.request(`/api/tasks/C1/chat?project=${PROJECT_ID}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ taskId: 'C1', canSend: false, blockedReason: 'noCompletedJob' })
    expect(body.turns).toEqual([])
  })

  test('after a step finished: canSend, and the session id is reported', async () => {
    seedTask('C2', { current_phase: 'implementer' })
    const stepRes = await runStep('C2')
    const { job } = await stepRes.json()
    await settle(job.id)
    // implementer -> reviewer chains automatically (B202608_1902) — wait for the
    // whole chain to settle first, otherwise this races the auto-submitted
    // reviewer job: while it's still running/queued, getTaskChatState treats the
    // task as having a live job and skips the finished-job transcript fallback,
    // so transcriptFound flips to false depending on how fast the chain runs.
    await waitForPhase('C2', (p) => p === 'completed')

    const res = await app.request(`/api/tasks/C2/chat?project=${PROJECT_ID}&stepId=implementer`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ taskId: 'C2', stepId: 'implementer', canSend: true })
    expect(body.sessionId).toBeTruthy()
    // Mock agent-cli job has stdout/log; chat falls back when the CLI transcript file is missing.
    expect(body.transcriptFound).toBe(true)
  })

  test('reports the running job so the UI can show a live step', async () => {
    gated = true
    seedTask('C3', { current_phase: 'implementer' })
    const stepRes = await runStep('C3')
    const { job } = await stepRes.json()
    for (let i = 0; i < 200 && loadJob(job.id)?.status !== 'running'; i++) await sleep(5)

    const res = await app.request(`/api/tasks/C3/chat?project=${PROJECT_ID}`)
    const body = await res.json()
    expect(body.running).toMatchObject({ jobId: job.id, stepId: 'implementer' })
    expect(body).toMatchObject({ canSend: true, queued: true })
    expect(body.blockedReason).toBeUndefined()

    gated = false
    resolveGate?.()
    await settle(job.id)
  })
})
