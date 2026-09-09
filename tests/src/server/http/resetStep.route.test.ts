import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/api/apiServer.js'
import type { RegistryContext } from '../../../../src/core/http/types.js'
import { loadJob, listJobs, registerProvider, upsertConnection, upsertRunner } from '../../../../src/features/runner/business/index.js'
import type { ExecuteRequest, ExecuteResult, RunnerProvider } from '../../../../src/features/runner/business/types.js'

// Route-level contract for POST /api/tasks/:id/reset-step — the recycle
// button on an already-run pipeline node. Same style as runStep.route.test.ts
// (app.request against a real Hono app + a temp `.dev-team-agent` root).

const PROVIDER_ID = 'stub-reset-step-route'

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

const PIPELINE = [
  'version: 1',
  'steps:',
  "  - id: investigator",
  "    agent: ' '",
  '    produces: [investigate.md]',
  "  - id: designer",
  "    agent: ' '",
  '    produces: [design.md]',
  "  - id: implementer",
  "    agent: ' '",
  '    produces: [phpstan.md]',
  "  - id: reviewer",
  "    agent: ' '",
  '    produces: [review.md]',
  "    hitl: { mode: manual, gate_id: hitl-3 }",
].join('\n')

function seedTask(taskId: string, state: Record<string, unknown>, files: Record<string, string> = {}) {
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tasks', taskId), { recursive: true })
  fs.writeFileSync(
    path.join(root, '.dev-state', `${taskId}.json`),
    JSON.stringify({ task_id: taskId, ...state }, null, 2),
    'utf8',
  )
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, 'tasks', taskId, name), content, 'utf8')
  }
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-reset-step-route-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = path.join(root, '.home')
  registerProvider(stubProvider)
  upsertConnection({ id: 'stub-conn-reset-step', kind: 'local-console', providerId: PROVIDER_ID, cliPath: 'stub' })
  upsertRunner({ id: 'stub-runner-reset-step', connectionId: 'stub-conn-reset-step', config: {} })
  fs.writeFileSync(path.join(root, 'pipeline.yaml'), PIPELINE, 'utf8')
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

describe('POST /api/tasks/:id/reset-step', () => {
  test('200: resets current_phase back to stepId, deletes its artifact, returns removedSteps', async () => {
    seedTask('RS1', { current_phase: 'reviewer' }, { 'phpstan.md': 'impl output' })
    const res = await app.request('/api/tasks/RS1/reset-step', {
      method: 'POST',
      body: JSON.stringify({ stepId: 'implementer', cascade: false }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.removedSteps).toEqual(['implementer'])
    expect(body.state.current_phase).toBe('implementer')
    expect(fs.existsSync(path.join(root, 'tasks', 'RS1', 'phpstan.md'))).toBe(false)
  })

  test('200: cascade removes the target and every step after it', async () => {
    seedTask(
      'RS2',
      { current_phase: 'completed' },
      { 'phpstan.md': 'impl', 'review.md': 'review' },
    )
    const res = await app.request('/api/tasks/RS2/reset-step', {
      method: 'POST',
      body: JSON.stringify({ stepId: 'implementer', cascade: true }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.removedSteps).toEqual(['implementer', 'reviewer'])
    expect(fs.existsSync(path.join(root, 'tasks', 'RS2', 'review.md'))).toBe(false)
  })

  test('400: stepId not in the pipeline', async () => {
    seedTask('RS3', { current_phase: 'reviewer' })
    const res = await app.request('/api/tasks/RS3/reset-step', {
      method: 'POST',
      body: JSON.stringify({ stepId: 'nope', cascade: false }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid reset target')
  })

  test('400: target is after current_phase (nothing to reset yet)', async () => {
    seedTask('RS4', { current_phase: 'implementer' })
    const res = await app.request('/api/tasks/RS4/reset-step', {
      method: 'POST',
      body: JSON.stringify({ stepId: 'reviewer', cascade: false }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid reset target')
    const state = JSON.parse(fs.readFileSync(path.join(root, '.dev-state', 'RS4.json'), 'utf8'))
    expect(state.current_phase).toBe('implementer')
  })

  test('400: invalid body (cascade missing)', async () => {
    seedTask('RS5', { current_phase: 'reviewer' })
    const res = await app.request('/api/tasks/RS5/reset-step', {
      method: 'POST',
      body: JSON.stringify({ stepId: 'implementer' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid request')
  })

  test('400: invalid task id', async () => {
    const res = await app.request('/api/tasks/RS%21bad/reset-step', {
      method: 'POST',
      body: JSON.stringify({ stepId: 'implementer', cascade: false }),
    })
    expect(res.status).toBe(400)
  })

  test('404: task not found', async () => {
    const res = await app.request('/api/tasks/RS-missing/reset-step', {
      method: 'POST',
      body: JSON.stringify({ stepId: 'implementer', cascade: false }),
    })
    expect(res.status).toBe(404)
  })

  test('409: a job is already running for the task', async () => {
    gated = true
    seedTask('RS6', { current_phase: 'implementer' })
    fs.writeFileSync(path.join(root, 'tasks', 'RS6', 'request.md'), 'do the thing', 'utf8')
    const runRes = await app.request('/api/tasks/RS6/run-step', {
      method: 'POST',
      body: JSON.stringify({ runnerId: 'stub-runner-reset-step' }),
    })
    expect(runRes.status).toBe(201)
    const { job } = await runRes.json()
    for (let i = 0; i < 200 && loadJob(job.id)?.status !== 'running'; i++) await sleep(5)
    expect(loadJob(job.id)?.status).toBe('running')

    const res = await app.request('/api/tasks/RS6/reset-step', {
      method: 'POST',
      body: JSON.stringify({ stepId: 'implementer', cascade: false }),
    })
    expect(res.status).toBe(409)

    gated = false
    resolveGate?.()
    for (let i = 0; i < 200 && loadJob(job.id)?.status === 'running'; i++) await sleep(5)
  })

  test('completed task can reset back to any earlier step', async () => {
    seedTask('RS7', { current_phase: 'completed' }, { 'investigate.md': 'i' })
    const res = await app.request('/api/tasks/RS7/reset-step', {
      method: 'POST',
      body: JSON.stringify({ stepId: 'investigator', cascade: false }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.state.current_phase).toBe('investigator')
  })

  test('clears an open hitl_pending gate without requiring it to be resolved first', async () => {
    seedTask('RS8', { current_phase: 'reviewer', hitl_pending: 'hitl-3' }, { 'review.md': 'r' })
    const res = await app.request('/api/tasks/RS8/reset-step', {
      method: 'POST',
      body: JSON.stringify({ stepId: 'reviewer', cascade: false }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.state.hitl_pending).toBeNull()
  })

  test('a successful reset is recorded in the audit log', async () => {
    seedTask('RS9', { current_phase: 'reviewer' }, { 'phpstan.md': 'impl' })
    const res = await app.request('/api/tasks/RS9/reset-step', {
      method: 'POST',
      body: JSON.stringify({ stepId: 'implementer', cascade: false }),
    })
    expect(res.status).toBe(200)
    await sleep(20) // emitAudit is fire-and-forget
    const logRes = await app.request('/api/logs?type=audit')
    const entries = (await logRes.json()).entries as any[]
    expect(
      entries.some(
        (e) => e.entity === 'task-state' && e.identifier === 'RS9' && e.detail?.action === 'reset-step',
      ),
    ).toBe(true)
  })
})
