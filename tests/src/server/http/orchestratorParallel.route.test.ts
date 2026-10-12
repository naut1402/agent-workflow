import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/backend/apiServer.js'
import type { RegistryContext } from '../../../../src/backend/http/types.js'
import { SelfMcpServer } from '../../../../src/features/mcp/business/index.js'
import { _resetOrchestratorForTest } from '../../../../src/features/orchestrator/business/decisionLoop.js'
import { mintOrchestratorToken } from '../../../../src/features/orchestrator/business/orchestratorTokens.js'
import { listJobs, loadJob } from '../../../../src/features/runner/business/index.js'
import { hasPendingOrchestratorChat } from '../../../../src/features/monitor/business/tasks/state.js'
import { ORCHESTRATOR_STEP_ID } from '../../../../src/shared/lib/orchestrator.js'

/*
 * Ted0cf9ac — bề mặt HTTP khi job điều phối và job step cùng sống.
 *
 *   - `POST /api/tasks/:id/feedback` (stepId = nút điều phối): `201 { queued: true }`
 *     khi nút bận, không còn `409 orchestrator busy` (TC-21); validation cũ giữ
 *     nguyên và input bị từ chối không vào hàng chờ (TC-27).
 *   - `GET /api/orchestrator/output` · `POST /api/orchestrator/decide`: nhắm đúng
 *     loại job bất kể job nào bắt đầu sau (TC-31, TC-32, TC-32a) + review [should] #1
 *     (job step `running` thắng job `queued` mới hơn).
 *   - `GET /api/tasks/:id/chat`: panel nút điều phối nói về job điều phối, panel
 *     step nói về job step (TC-31 phía panel).
 *
 * Job ghi thẳng làm record (`running` / `queued`) — chỉ cần trạng thái sống, không
 * cần runner chạy thật.
 */

const PROJECT_ID = 'proj-orch-par'
let home: string
let root: string
let app: Awaited<ReturnType<typeof createApp>>
const savedEnv = { ...process.env }

function fakeCtx(): RegistryContext {
  return {
    defaultRoot: root,
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

function writePipeline(enabled = true) {
  fs.writeFileSync(
    path.join(root, 'pipeline.yaml'),
    [
      'version: 1',
      ...(enabled ? ['orchestrator: { enabled: true, agent: "a:orch" }'] : []),
      'steps:',
      '  - { id: implementer, name: Implement, agent: " " }',
      '  - { id: reviewer, name: Review, agent: " " }',
    ].join('\n'),
    'utf8',
  )
}

function seedTask(taskId: string, state: Record<string, unknown> = {}) {
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tasks', taskId), { recursive: true })
  fs.writeFileSync(path.join(root, 'tasks', taskId, 'request.md'), '# yêu cầu\n', 'utf8')
  fs.writeFileSync(
    path.join(root, '.dev-state', `${taskId}.json`),
    JSON.stringify({ task_id: taskId, current_phase: 'implementer', orchestrator_enabled: true, ...state }),
    'utf8',
  )
}

function stateOf(taskId: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(root, '.dev-state', `${taskId}.json`), 'utf8'))
}

let seq = 0
function uuid(): string {
  seq++
  return `bbbbbbbb-${String(seq).padStart(4, '0')}-4ccc-dddd-eeeeeeeeeeee`
}

function writeJob(metadata: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  const id = uuid()
  const dir = path.join(home, 'jobs')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify({
      id,
      status: 'running',
      runnerId: 'r',
      agentRef: 'a',
      workspace: path.join(root, 'tasks', String(metadata.taskId)),
      createdAt: new Date().toISOString(),
      metadata: { devTeamRoot: root, projectId: PROJECT_ID, ...metadata },
      ...extra,
    }),
    'utf8',
  )
  return id
}

function writeJobLog(id: string, text: string) {
  fs.writeFileSync(path.join(home, 'jobs', `${id}.log`), text, 'utf8')
}

function at(offsetSec: number): string {
  return new Date(Date.now() + offsetSec * 1000).toISOString()
}

/** S1 (step) + O1 (điều phối) cùng `running`, theo thứ tự bắt đầu chọn được. */
function bothRunning(taskId: string, order: 'step-first' | 'orch-first') {
  const stepAt = order === 'step-first' ? at(-20) : at(-5)
  const orchAt = order === 'step-first' ? at(-5) : at(-20)
  const s1 = writeJob({ taskId, pipelineStepId: 'implementer' }, { createdAt: stepAt })
  const o1 = writeJob({ taskId, orchestratorJob: true, orchestratorTrigger: 'chat', stepId: ORCHESTRATOR_STEP_ID }, { createdAt: orchAt })
  writeJobLog(s1, 'STEP-OUT\n')
  writeJobLog(o1, 'ORCH-OUT\n')
  return { s1, o1 }
}

async function feedback(taskId: string, body: Record<string, unknown>) {
  return app.request(`/api/tasks/${taskId}/feedback?project=${PROJECT_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function output(taskId: string) {
  return app.request('/api/orchestrator/output?offset=0', {
    headers: { [SelfMcpServer.TOKEN_HEADER]: mintOrchestratorToken({ taskId, root, projectId: '' }) },
  })
}

async function decide(taskId: string, body: Record<string, unknown>) {
  return app.request('/api/orchestrator/decide', {
    method: 'POST',
    headers: {
      [SelfMcpServer.TOKEN_HEADER]: mintOrchestratorToken({ taskId, root, projectId: '' }),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

async function chatState(taskId: string, stepId: string) {
  const res = await app.request(`/api/tasks/${taskId}/chat?project=${PROJECT_ID}&stepId=${encodeURIComponent(stepId)}`)
  expect(res.status).toBe(200)
  return res.json()
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-orch-par-route-home-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
})
beforeEach(async () => {
  _resetOrchestratorForTest()
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-orch-par-route-root-'))
  writePipeline()
  app = await createApp(fakeCtx())
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('POST /api/tasks/:id/feedback — nút điều phối bận (TC-21)', () => {
  test('job điều phối đang chạy ⇒ 201 { queued: true }, không 409, không thêm job, tin nhắn lưu bền', async () => {
    seedTask('R21')
    writeJob({ taskId: 'R21', orchestratorJob: true, orchestratorTrigger: 'step_finished' })
    const before = listJobs(500).filter((j) => j.metadata?.taskId === 'R21').length

    const res = await feedback('R21', { feedback: 'M1', stepId: ORCHESTRATOR_STEP_ID })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ queued: true })
    expect(listJobs(500).filter((j) => j.metadata?.taskId === 'R21')).toHaveLength(before)
    expect(stateOf('R21').pending_orchestrator_chat.messages).toEqual(['M1'])
  })

  test('chỉ job step đang chạy (nút rảnh) ⇒ 201 kèm job, KHÔNG queued (TC-01 ở tầng HTTP)', async () => {
    seedTask('R21b')
    writeJob({ taskId: 'R21b', pipelineStepId: 'implementer' })
    const res = await feedback('R21b', { feedback: 'hỏi', stepId: ORCHESTRATOR_STEP_ID })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.queued).toBeUndefined()
    expect(body.job?.metadata?.orchestratorJob).toBe(true)
    expect(stateOf('R21b').pending_orchestrator_chat ?? null).toBeNull()
  })
})

describe('TC-27 — validation tin nhắn không đổi; input bị từ chối không vào hàng chờ', () => {
  for (const busy of [false, true]) {
    test(`tin nhắn rỗng (${busy ? 'bận' : 'rảnh'}) ⇒ 400 như cũ, không xếp hàng`, async () => {
      const T = busy ? 'R27-busy' : 'R27-idle'
      seedTask(T)
      if (busy) writeJob({ taskId: T, orchestratorJob: true, orchestratorTrigger: 'chat' })
      const res = await feedback(T, { feedback: '', stepId: ORCHESTRATOR_STEP_ID })
      expect(res.status).toBe(400)
      expect(stateOf(T).pending_orchestrator_chat ?? null).toBeNull()
    })
  }

  // Schema `feedback: z.string().min(1)` có từ trước KHÔNG chặn chuỗi chỉ khoảng
  // trắng — giữ nguyên mã trả về cũ. Khi bận, chuỗi đó không thành tin nhắn chờ
  // nào gửi được (hàng chờ lọc phần tử rỗng khi đọc).
  test('tin nhắn chỉ khoảng trắng: rảnh ⇒ 201 như cũ; bận ⇒ không có tin nhắn chờ hợp lệ nào', async () => {
    seedTask('R27-ws-idle')
    expect((await feedback('R27-ws-idle', { feedback: '   ', stepId: ORCHESTRATOR_STEP_ID })).status).toBe(201)

    seedTask('R27-ws-busy')
    writeJob({ taskId: 'R27-ws-busy', orchestratorJob: true, orchestratorTrigger: 'chat' })
    const res = await feedback('R27-ws-busy', { feedback: '   ', stepId: ORCHESTRATOR_STEP_ID })
    expect(res.status).not.toBe(409)
    expect(hasPendingOrchestratorChat(stateOf('R27-ws-busy'))).toBe(false)
  })

  test('task không bật nút điều phối (kể cả khi có job điều phối sống) ⇒ 409 "not active", không xếp hàng', async () => {
    writePipeline(false)
    seedTask('R27-off', { orchestrator_enabled: false })
    writeJob({ taskId: 'R27-off', orchestratorJob: true, orchestratorTrigger: 'chat' })
    const res = await feedback('R27-off', { feedback: 'M1', stepId: ORCHESTRATOR_STEP_ID })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('orchestrator is not active for this task')
    expect(stateOf('R27-off').pending_orchestrator_chat ?? null).toBeNull()
  })

  test('task không tồn tại ⇒ 404', async () => {
    const res = await feedback('KHONG-CO', { feedback: 'M1', stepId: ORCHESTRATOR_STEP_ID })
    expect(res.status).toBe(404)
  })
})

describe('GET /api/orchestrator/output + panel chat — TC-31', () => {
  for (const order of ['step-first', 'orch-first'] as const) {
    test(`S1 và O1 cùng running (${order}) ⇒ output đọc job step, panel nút điều phối nói về O1`, async () => {
      const T = `R31-${order}`
      seedTask(T)
      const { s1, o1 } = bothRunning(T, order)

      const body = await (await output(T)).json()
      expect(body.text).toContain('STEP-OUT')
      expect(body.text).not.toContain('ORCH-OUT')

      const orchPanel = await chatState(T, ORCHESTRATOR_STEP_ID)
      expect(orchPanel.running?.jobId).toBe(o1)
      expect(orchPanel.running?.jobId).not.toBe(s1)
    })
  }

  test('review [should] #1: job step running + job step queued MỚI HƠN ⇒ output đọc job running', async () => {
    const T = 'R31-q'
    seedTask(T)
    const s1 = writeJob({ taskId: T, pipelineStepId: 'implementer' }, { createdAt: at(-30) })
    writeJobLog(s1, 'RUNNING-OUT\n')
    writeJob({ taskId: T, pipelineStepId: 'implementer', isChatFeedback: true }, { status: 'queued', createdAt: at(-1) })
    writeJob({ taskId: T, orchestratorJob: true, orchestratorTrigger: 'chat' }, { createdAt: at(0) })
    const body = await (await output(T)).json()
    expect(body.text).toContain('RUNNING-OUT')
  })
})

describe('POST /api/orchestrator/decide — TC-32 / TC-32a', () => {
  const SUMMARY = { action: 'summary', summary: 'đang theo dõi', reason: 'test' }

  for (const order of ['step-first', 'orch-first'] as const) {
    test(`TC-32 (${order}): quyết định đánh dấu O1, S1 không bị đụng`, async () => {
      const T = `R32-${order}`
      seedTask(T)
      const { s1, o1 } = bothRunning(T, order)
      const res = await decide(T, SUMMARY)
      expect(res.status).toBe(200)
      expect(loadJob(o1)?.metadata?.directDecisionApplied).toBe(true)
      const step = loadJob(s1)
      expect(step?.metadata?.directDecisionApplied).toBeUndefined()
      expect(step?.status).toBe('running')
    })
  }

  test('TC-32a: chỉ S1 running, không job điều phối ⇒ output không lộ gì của điều phối, decide không đánh dấu S1', async () => {
    const T = 'R32a'
    seedTask(T)
    const s1 = writeJob({ taskId: T, pipelineStepId: 'implementer' })
    writeJobLog(s1, 'STEP-OUT\n')

    const out = await (await output(T)).json()
    expect(out.text).not.toContain('ORCH-OUT')

    const res = await decide(T, SUMMARY)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ applied: 'summary' })
    const step = loadJob(s1)
    expect(step?.metadata?.directDecisionApplied).toBeUndefined()
    expect(step?.status).toBe('running')
  })
})
