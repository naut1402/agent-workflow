import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/backend/apiServer.js'
import type { RegistryContext } from '../../../../src/backend/http/types.js'
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
      body: JSON.stringify({ stepId: 'implementer', resetScope: 'step', deleteScope: 'step' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.removedSteps).toEqual(['implementer'])
    expect(body.state.current_phase).toBe('implementer')
    expect(fs.existsSync(path.join(root, 'tasks', 'RS1', 'phpstan.md'))).toBe(false)
  })

  test('TC-C04: phạm vi onward xoá artifact của step đích và mọi step sau', async () => {
    seedTask(
      'RS2',
      { current_phase: 'completed' },
      { 'phpstan.md': 'impl', 'review.md': 'review' },
    )
    const res = await app.request('/api/tasks/RS2/reset-step', {
      method: 'POST',
      body: JSON.stringify({ stepId: 'implementer', resetScope: 'onward', deleteScope: 'onward' }),
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
      body: JSON.stringify({ stepId: 'nope', resetScope: 'step', deleteScope: 'step' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid reset target')
  })

  test('400: target is after current_phase (nothing to reset yet)', async () => {
    seedTask('RS4', { current_phase: 'implementer' })
    const res = await app.request('/api/tasks/RS4/reset-step', {
      method: 'POST',
      body: JSON.stringify({ stepId: 'reviewer', resetScope: 'step', deleteScope: 'step' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid reset target')
    const state = JSON.parse(fs.readFileSync(path.join(root, '.dev-state', 'RS4.json'), 'utf8'))
    expect(state.current_phase).toBe('implementer')
  })

  test('TC-C07: thiếu trường phạm vi trong body → 400, không có mặc định âm thầm', async () => {
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
      body: JSON.stringify({ stepId: 'implementer', resetScope: 'step', deleteScope: 'step' }),
    })
    expect(res.status).toBe(400)
  })

  test('404: task not found', async () => {
    const res = await app.request('/api/tasks/RS-missing/reset-step', {
      method: 'POST',
      body: JSON.stringify({ stepId: 'implementer', resetScope: 'step', deleteScope: 'step' }),
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
      body: JSON.stringify({ stepId: 'implementer', resetScope: 'step', deleteScope: 'step' }),
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
      body: JSON.stringify({ stepId: 'investigator', resetScope: 'step', deleteScope: 'step' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.state.current_phase).toBe('investigator')
  })

  test('clears an open hitl_pending gate without requiring it to be resolved first', async () => {
    seedTask('RS8', { current_phase: 'reviewer', hitl_pending: 'hitl-3' }, { 'review.md': 'r' })
    const res = await app.request('/api/tasks/RS8/reset-step', {
      method: 'POST',
      body: JSON.stringify({ stepId: 'reviewer', resetScope: 'step', deleteScope: 'step' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.state.hitl_pending).toBeNull()
  })

  test('a successful reset is recorded in the audit log', async () => {
    seedTask('RS9', { current_phase: 'reviewer' }, { 'phpstan.md': 'impl' })
    const res = await app.request('/api/tasks/RS9/reset-step', {
      method: 'POST',
      body: JSON.stringify({ stepId: 'implementer', resetScope: 'step', deleteScope: 'step' }),
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

  // ---- Td16ee130 — hai trục phạm vi (`test-spec.md` nhóm C) ----

  test('TC-C01: reset chỉ step này + không xoá tài liệu — 2xx, con trỏ lùi đúng step, không file nào mất', async () => {
    seedTask('RC1', { current_phase: 'completed' }, { 'phpstan.md': 'impl', 'review.md': 'r' })
    const res = await app.request('/api/tasks/RC1/reset-step', {
      method: 'POST',
      body: JSON.stringify({ stepId: 'implementer', resetScope: 'step', deleteScope: 'none' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.state.current_phase).toBe('implementer')
    // Chỉ step đích rời trạng thái đã chạy; step sau giữ nguyên.
    expect(body.removedSteps).toEqual(['implementer'])
    expect(fs.existsSync(path.join(root, 'tasks', 'RC1', 'phpstan.md'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'tasks', 'RC1', 'review.md'))).toBe(true)
  })

  test('TC-C02: reset từ step này trở đi + không xoá tài liệu — mọi step sau rời trạng thái đã chạy, không file nào mất', async () => {
    seedTask('RC2', { current_phase: 'completed' }, { 'phpstan.md': 'impl', 'review.md': 'r' })
    const res = await app.request('/api/tasks/RC2/reset-step', {
      method: 'POST',
      body: JSON.stringify({ stepId: 'implementer', resetScope: 'onward', deleteScope: 'none' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.removedSteps).toEqual(['implementer', 'reviewer'])
    expect(fs.existsSync(path.join(root, 'tasks', 'RC2', 'phpstan.md'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'tasks', 'RC2', 'review.md'))).toBe(true)
  })

  test('TC-C03: xoá tài liệu phạm vi step — artifact của step khác còn nguyên', async () => {
    seedTask('RC3', { current_phase: 'completed' }, { 'design.md': 'd', 'phpstan.md': 'impl', 'review.md': 'r' })
    const res = await app.request('/api/tasks/RC3/reset-step', {
      method: 'POST',
      body: JSON.stringify({ stepId: 'implementer', resetScope: 'step', deleteScope: 'step' }),
    })
    expect(res.status).toBe(200)
    expect(fs.existsSync(path.join(root, 'tasks', 'RC3', 'phpstan.md'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'tasks', 'RC3', 'design.md'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'tasks', 'RC3', 'review.md'))).toBe(true)
  })

  test('TC-C05: tổ hợp bị cấm (reset step + xoá onward) → 400, không đổi state, không xoá file', async () => {
    seedTask('RC5', { current_phase: 'completed' }, { 'phpstan.md': 'impl', 'review.md': 'r' })
    const res = await app.request('/api/tasks/RC5/reset-step', {
      method: 'POST',
      body: JSON.stringify({ stepId: 'implementer', resetScope: 'step', deleteScope: 'onward' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid request')
    // Thông điệp nêu rõ ràng buộc, không phải "invalid" trống trơn.
    expect(JSON.stringify(body.details)).toContain('deleteScope')
    const state = JSON.parse(fs.readFileSync(path.join(root, '.dev-state', 'RC5.json'), 'utf8'))
    expect(state.current_phase).toBe('completed')
    expect(fs.existsSync(path.join(root, 'tasks', 'RC5', 'phpstan.md'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'tasks', 'RC5', 'review.md'))).toBe(true)
  })

  test('TC-C06: giá trị enum không hợp lệ → 400, không side-effect', async () => {
    seedTask('RC6', { current_phase: 'completed' }, { 'phpstan.md': 'impl' })
    const res = await app.request('/api/tasks/RC6/reset-step', {
      method: 'POST',
      body: JSON.stringify({ stepId: 'implementer', resetScope: 'everything', deleteScope: 'none' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid request')
    const state = JSON.parse(fs.readFileSync(path.join(root, '.dev-state', 'RC6.json'), 'utf8'))
    expect(state.current_phase).toBe('completed')
    expect(fs.existsSync(path.join(root, 'tasks', 'RC6', 'phpstan.md'))).toBe(true)
  })

  test('body của hợp đồng cũ (`cascade`) bị từ chối thẳng, không có shim tương thích', async () => {
    seedTask('RC7', { current_phase: 'completed' }, { 'phpstan.md': 'impl' })
    const res = await app.request('/api/tasks/RC7/reset-step', {
      method: 'POST',
      body: JSON.stringify({ stepId: 'implementer', cascade: true }),
    })
    expect(res.status).toBe(400)
    expect(fs.existsSync(path.join(root, 'tasks', 'RC7', 'phpstan.md'))).toBe(true)
  })

  test('TC-C10: taskId / stepId mang path traversal bị từ chối, không đụng file nào ngoài thư mục task', async () => {
    seedTask('RC10', { current_phase: 'completed' }, { 'phpstan.md': 'impl' })
    const outside = path.join(root, 'outside-secret.md')
    fs.writeFileSync(outside, 'không được đụng', 'utf8')

    const bodies = [
      { stepId: '../../../etc/passwd', resetScope: 'step', deleteScope: 'step' },
      { stepId: '..%2fdesigner', resetScope: 'step', deleteScope: 'step' },
      { stepId: '/etc/passwd', resetScope: 'step', deleteScope: 'step' },
    ]
    for (const body of bodies) {
      const res = await app.request('/api/tasks/RC10/reset-step', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      expect(res.status).toBeGreaterThanOrEqual(400)
    }

    for (const badId of ['../RC10', '..%2f..%2fetc', '/etc']) {
      const res = await app.request(`/api/tasks/${encodeURIComponent(badId)}/reset-step`, {
        method: 'POST',
        body: JSON.stringify({ stepId: 'implementer', resetScope: 'step', deleteScope: 'step' }),
      })
      expect(res.status).toBeGreaterThanOrEqual(400)
    }

    expect(fs.existsSync(outside)).toBe(true)
    expect(fs.existsSync(path.join(root, 'tasks', 'RC10', 'phpstan.md'))).toBe(true)
    fs.rmSync(outside, { force: true })
  })

  test('TC-C11/TC-C12: gọi lại lần hai (hoặc file đã bị xoá tay) vẫn 2xx, không rò ENOENT', async () => {
    seedTask('RC11', { current_phase: 'completed' }, { 'phpstan.md': 'impl' })
    const send = () =>
      app.request('/api/tasks/RC11/reset-step', {
        method: 'POST',
        body: JSON.stringify({ stepId: 'implementer', resetScope: 'step', deleteScope: 'step' }),
      })

    const first = await send()
    expect(first.status).toBe(200)
    const firstBody = await first.json()

    const second = await send()
    expect(second.status).toBe(200)
    const secondBody = await second.json()
    expect(secondBody.state.current_phase).toBe(firstBody.state.current_phase)
    expect(secondBody.removedSteps).toEqual(firstBody.removedSteps)
    expect(JSON.stringify(secondBody)).not.toContain('ENOENT')
  })

  test('TC-C09: task không tồn tại → 404 và không tạo thư mục/file nào cho nó', async () => {
    const res = await app.request('/api/tasks/RC-ghost/reset-step', {
      method: 'POST',
      body: JSON.stringify({ stepId: 'implementer', resetScope: 'step', deleteScope: 'none' }),
    })
    expect(res.status).toBe(404)
    expect(fs.existsSync(path.join(root, 'tasks', 'RC-ghost'))).toBe(false)
    expect(fs.existsSync(path.join(root, '.dev-state', 'RC-ghost.json'))).toBe(false)
  })

  test('audit log ghi đủ hai trục phạm vi thay cho cascade', async () => {
    seedTask('RC12', { current_phase: 'completed' }, { 'phpstan.md': 'impl' })
    const res = await app.request('/api/tasks/RC12/reset-step', {
      method: 'POST',
      body: JSON.stringify({ stepId: 'implementer', resetScope: 'onward', deleteScope: 'step' }),
    })
    expect(res.status).toBe(200)
    await sleep(20) // emitAudit là fire-and-forget
    const logRes = await app.request('/api/logs?type=audit')
    const entries = (await logRes.json()).entries as any[]
    const entry = entries.find(
      (e) => e.entity === 'task-state' && e.identifier === 'RC12' && e.detail?.action === 'reset-step',
    )
    expect(entry).toBeTruthy()
    expect(entry.detail.resetScope).toBe('onward')
    expect(entry.detail.deleteScope).toBe('step')
    expect(entry.detail.cascade).toBeUndefined()
  })
})
