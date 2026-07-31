import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/server/http/app.js'
import type { RegistryContext } from '../../../../src/server/registry.js'
import {
  submitApprovalJob,
  loadJob,
  registerProvider,
  upsertConnection,
  upsertRunner,
} from '../../../../src/server/runners/index.js'
import type { ExecuteRequest, ExecuteResult, RunnerProvider } from '../../../../src/server/runners/types.js'

// Route-level contract for the approval-flow job endpoints
// (GET /api/jobs/:id/proposal, POST .../approve|discard|feedback), driven via
// Hono's app.request (same style as app.request.test.ts). A stub provider writes
// the proposed edit into the scratch workspace so a job can reach
// `awaiting_approval` without spawning a real CLI.

const PROVIDER_ID = 'stub-approval-route'

const stubProvider: RunnerProvider = {
  providerId: PROVIDER_ID,
  validateRunnerConfig: () => ({ ok: true, errors: [] }),
  validateCredential: () => ({ ok: true, errors: [] }),
  capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }),
  async execute(req: ExecuteRequest): Promise<ExecuteResult> {
    const target = String((req.metadata as any)?.targetFile ?? '')
    if (target) {
      const p = path.join(req.workspace, target)
      let prev = ''
      try {
        prev = fs.readFileSync(p, 'utf8')
      } catch {
        /* new file */
      }
      fs.writeFileSync(p, `${prev}\n[edit: ${req.userPrompt}]`, 'utf8')
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

function makeWorkspace(content: string): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-approval-route-ws-'))
  fs.writeFileSync(path.join(ws, 'design.md'), content, 'utf8')
  return ws
}

async function awaitingJob(content = 'original\n') {
  const ws = makeWorkspace(content)
  const job = submitApprovalJob({
    runnerId: 'stub-runner-route',
    agentRef: '',
    workspace: ws,
    userPrompt: 'round1',
    approvalArtifact: 'design.md',
    metadata: { targetFile: 'design.md' },
  })
  await settle(job.id)
  return { ws, job }
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-approval-route-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = path.join(root, '.home')
  registerProvider(stubProvider)
  upsertConnection({ id: 'stub-conn-route', kind: 'local-console', providerId: PROVIDER_ID, cliPath: 'stub' })
  upsertRunner({ id: 'stub-runner-route', connectionId: 'stub-conn-route', config: {} })
  app = createApp(fakeCtx())
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(root, { recursive: true, force: true })
})
beforeEach(() => {})

describe('approval-flow job routes', () => {
  test('GET /api/jobs/:id/proposal → 200 with before/after', async () => {
    const { job } = await awaitingJob()
    const res = await app.request(`/api/jobs/${job.id}/proposal`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.artifactName).toBe('design.md')
    expect(body.before).toBe('original\n')
    expect(body.after).toBe('original\n\n[edit: round1]')
  })

  test('GET /api/jobs/:id/proposal → 404 for an unknown job', async () => {
    const res = await app.request('/api/jobs/11111111-2222-4333-8444-555555555555/proposal')
    expect(res.status).toBe(404)
  })

  test('POST /api/jobs/:id/feedback with empty body → 400', async () => {
    const { job } = await awaitingJob()
    const res = await app.request(`/api/jobs/${job.id}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ feedback: '   ' }),
    })
    expect(res.status).toBe(400)
  })

  test('POST /api/jobs/:id/feedback → 201 with a new awaiting job continuing the session', async () => {
    const { job } = await awaitingJob()
    const res = await app.request(`/api/jobs/${job.id}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ feedback: 'round2' }),
    })
    expect(res.status).toBe(201)
    const { job: child } = await res.json()
    expect(child.parentJobId).toBe(job.id)
    expect(child.id).not.toBe(job.id)
    const childDone = await settle(child.id)
    expect(childDone.status).toBe('awaiting_approval')
  })

  test('POST /api/jobs/:id/approve → 200 and the real file gets the proposed content', async () => {
    const { ws, job } = await awaitingJob()
    const res = await app.request(`/api/jobs/${job.id}/approve`, { method: 'POST' })
    expect(res.status).toBe(200)
    const { job: approved } = await res.json()
    expect(approved.status).toBe('succeeded')
    expect(fs.readFileSync(path.join(ws, 'design.md'), 'utf8')).toBe('original\n\n[edit: round1]')
  })

  test('POST /api/jobs/:id/discard → 200 and the real file is unchanged', async () => {
    const { ws, job } = await awaitingJob()
    const res = await app.request(`/api/jobs/${job.id}/discard`, { method: 'POST' })
    expect(res.status).toBe(200)
    const { job: discarded } = await res.json()
    expect(discarded.status).toBe('cancelled')
    expect(fs.readFileSync(path.join(ws, 'design.md'), 'utf8')).toBe('original\n')
  })

  test('POST /api/jobs/:id/approve on an already-resolved job → 400', async () => {
    const { job } = await awaitingJob()
    await app.request(`/api/jobs/${job.id}/approve`, { method: 'POST' })
    const res = await app.request(`/api/jobs/${job.id}/approve`, { method: 'POST' })
    expect(res.status).toBe(400)
  })
})
