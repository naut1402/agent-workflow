import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/backend/apiServer.js'
import type { RegistryContext } from '../../../../src/backend/http/types.js'
import { ORCHESTRATOR_TOKEN_HEADER } from '../../../../src/features/orchestrator/controller.js'
import { mintOrchestratorToken, revokeOrchestratorTokensFor } from '../../../../src/features/orchestrator/business/orchestratorTokens.js'
import { listJobs, loadJob, registerProvider, upsertConnection, upsertRunner } from '../../../../src/features/runner/business/index.js'
import type { ExecuteResult, RunnerProvider } from '../../../../src/features/runner/business/types.js'

/*
 * `GET /api/orchestrator/status` · `GET /api/orchestrator/output` ·
 * `POST /api/orchestrator/decide` — bề mặt thật mà orchestrator gọi ngược vào
 * server giữa lượt, bằng shell command (`curl`), thay cho MCP tool-call của
 * bản trước (design.md T528bf0ed §1/§3.1 bản v2). Test qua `app.request()`
 * (Hono test client) — đúng cách 1 route REST thường được chấm trong repo,
 * không cần dựng Client/transport nào của SDK MCP nữa.
 *
 * Phủ test-spec.md TC-01…TC-11 (Bug A): trạng thái, đọc output, start/resume/
 * halt, cách ly theo task/root (G3), xác thực token (G3/TC-09/TC-10), chống
 * double-dispatch (G4/TC-11).
 */

const PROVIDER_ID = 'stub-orchestrator-api'
const RUNNER_ID = 'stub-runner-orchestrator-api'

let home: string
let root: string
let app: Awaited<ReturnType<typeof createApp>>
const savedEnv = { ...process.env }

const stubProvider: RunnerProvider = {
  providerId: PROVIDER_ID,
  validateRunnerConfig: () => ({ ok: true, errors: [] }),
  validateCredential: () => ({ ok: true, errors: [] }),
  capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }),
  async execute(): Promise<ExecuteResult> {
    return { ok: true, exitCode: 0, durationMs: 1 }
  },
}

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

function writePipeline() {
  fs.writeFileSync(
    path.join(root, 'pipeline.yaml'),
    [
      'version: 1',
      'orchestrator: { enabled: true, agent: "a:orch" }',
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

function stateOf(taskId: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(root, '.dev-state', `${taskId}.json`), 'utf8'))
}

/** Ghi thẳng một job record — mô phỏng "step khác đang chạy" mà orchestrator hỏi tới giữa lượt. */
function writeJob(id: string, metadata: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const dir = path.join(home, 'jobs')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify({
      id,
      status: 'running',
      runnerId: 'r',
      agentRef: 'a',
      workspace: path.join(root, 'tasks', String(metadata.taskId ?? 'T')),
      createdAt: new Date().toISOString(),
      metadata: { devTeamRoot: root, ...metadata },
      ...extra,
    }),
    'utf8',
  )
  return id
}

function writeJobLog(id: string, text: string) {
  fs.mkdirSync(path.join(home, 'jobs'), { recursive: true })
  fs.writeFileSync(path.join(home, 'jobs', `${id}.log`), text, 'utf8')
}

function tokenFor(taskId: string): string {
  return mintOrchestratorToken({ taskId, root, projectId: '' })
}

async function status(token?: string) {
  return app.request('/api/orchestrator/status', {
    headers: token ? { [ORCHESTRATOR_TOKEN_HEADER]: token } : undefined,
  })
}

async function output(token: string | undefined, offset = 0) {
  return app.request(`/api/orchestrator/output?offset=${offset}`, {
    headers: token ? { [ORCHESTRATOR_TOKEN_HEADER]: token } : undefined,
  })
}

async function decide(token: string | undefined, body: Record<string, unknown>) {
  return app.request('/api/orchestrator/decide', {
    method: 'POST',
    headers: {
      ...(token ? { [ORCHESTRATOR_TOKEN_HEADER]: token } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-orch-api-home-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  registerProvider(stubProvider)
  upsertConnection({ id: 'stub-conn-orch-api', kind: 'local-console', providerId: PROVIDER_ID, cliPath: 'stub' } as any)
  upsertRunner({ id: RUNNER_ID, connectionId: 'stub-conn-orch-api', config: {} } as any)
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
})
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-orch-api-root-'))
  writePipeline()
  app = await createApp(fakeCtx())
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('GET /api/orchestrator/status — TC-01/TC-02', () => {
  test('TC-01: step khác đang chạy ⇒ phản ánh đúng NGAY, không cache/rỗng', async () => {
    seedTask('T1')
    writeJob('j1', { taskId: 'T1', pipelineStepId: 'implementer' }, { status: 'running' })
    const res = await status(tokenFor('T1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.activeStep).toMatchObject({ stepId: 'implementer', status: 'running', jobId: 'j1' })
  })

  test('TC-02: không step nào đang chạy ⇒ activeStep null, không lỗi/không giả trạng thái cũ', async () => {
    seedTask('T2')
    const res = await status(tokenFor('T2'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.activeStep).toBeNull()
    expect(body.currentPhase).toBe('implementer')
  })
})

describe('GET /api/orchestrator/output — TC-03/TC-04', () => {
  const JOB_T3 = 'aaaaaaaa-0003-4ccc-dddd-eeeeeeeeeeee'
  const JOB_T4 = 'aaaaaaaa-0004-4ccc-dddd-eeeeeeeeeeee'

  test('TC-03: job đang chạy đã có output ⇒ đọc được ngay, không đợi finished', async () => {
    seedTask('T3')
    writeJob(JOB_T3, { taskId: 'T3', pipelineStepId: 'implementer' }, { status: 'running' })
    writeJobLog(JOB_T3, 'đang chạy dở...\n')
    const res = await output(tokenFor('T3'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.text).toContain('đang chạy dở')
    expect(body.eof).toBe(false)
  })

  test('TC-04: job vừa dispatch, chưa có output ⇒ rỗng, không lỗi/không treo', async () => {
    seedTask('T4')
    writeJob(JOB_T4, { taskId: 'T4', pipelineStepId: 'implementer' }, { status: 'running' })
    const res = await output(tokenFor('T4'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.text).toBe('')
  })
})

describe('TC-08 — kênh chỉ tác động đúng task/root của chính orchestrator gọi nó', () => {
  test('taskId trùng tên ở root khác ⇒ không lộ trạng thái/output chéo', async () => {
    const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-orch-api-other-'))
    try {
      const JOB_OTHER = 'aaaaaaaa-0000-4ccc-dddd-eeeeeeeeeeee'
      seedTask('SAME')
      writeJob(
        JOB_OTHER,
        { taskId: 'SAME', pipelineStepId: 'implementer', devTeamRoot: otherRoot },
        { status: 'running' },
      )
      writeJobLog(JOB_OTHER, 'bí mật của root khác')

      const token = tokenFor('SAME')
      const statusBody = await (await status(token)).json()
      expect(statusBody.activeStep).toBeNull()

      const outputBody = await (await output(token)).json()
      expect(outputBody.text).toBe('')
      expect(outputBody.eof).toBe(true)
    } finally {
      fs.rmSync(otherRoot, { recursive: true, force: true })
    }
  })

  test('vế start: stepId hợp lệ NHƯNG không có tham số nào cho phép trỏ tới task khác', async () => {
    // Bất biến thiết kế: `POST /decide` không nhận `taskId`/`root` từ agent —
    // `ref` bị đóng cứng qua closure lúc mint token (không đọc từ query/body).
    seedTask('T5b')
    const res = await decide(tokenFor('T5b'), {
      action: 'start',
      stepId: 'implementer',
      taskId: 'khong-lien-quan',
      root: '/khong/ton/tai',
    })
    expect(res.status).toBe(200)
    expect(
      listJobs(200).some((j) => j.metadata?.taskId === 'T5b' && j.metadata?.pipelineStepId === 'implementer'),
    ).toBe(true)
    expect(listJobs(200).some((j) => j.metadata?.taskId === 'khong-lien-quan')).toBe(false)
  })
})

describe('POST /api/orchestrator/decide — TC-05/TC-06/TC-07', () => {
  test('TC-05: start có hiệu lực ngay — step chỉ định thực sự được dispatch, không cần đợi lượt orchestrator kết thúc', async () => {
    seedTask('T5')
    const res = await decide(tokenFor('T5'), { action: 'start', stepId: 'implementer' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ applied: 'start' })

    const jobs = listJobs(200).filter(
      (j) => j.metadata?.taskId === 'T5' && j.metadata?.pipelineStepId === 'implementer',
    )
    expect(jobs.length).toBeGreaterThan(0)
  })

  test('TC-06: stepId không có trong pipeline ⇒ 400, không dispatch/không side-effect', async () => {
    seedTask('T6')
    const res = await decide(tokenFor('T6'), { action: 'start', stepId: 'khong-co' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('unknown stepId')
    expect(listJobs(200).filter((j) => j.metadata?.taskId === 'T6')).toHaveLength(0)
    expect(stateOf('T6').current_phase).toBe('implementer')
  })

  test('TC-07: halt ⇒ có hiệu lực ngay, quan sát được qua state ngay sau (không đợi lượt kết thúc)', async () => {
    seedTask('T7')
    const res = await decide(tokenFor('T7'), { action: 'halt', reason: 'test' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ applied: 'halt' })
    expect(stateOf('T7').orchestrator_halted).toBe(true)
  })
})

describe('TC-11 — chống double-dispatch với sentinel cùng lượt', () => {
  test('gọi API decide đánh dấu job orchestrator hiện tại đã áp dụng quyết định (chặn đọc lại sentinel)', async () => {
    seedTask('T11')
    const jobId = writeJob(
      'j11-orch',
      { taskId: 'T11', orchestratorJob: true, orchestratorTrigger: 'step_finished' },
      { status: 'running' },
    )
    await decide(tokenFor('T11'), { action: 'start', stepId: 'reviewer' })
    const job = loadJob(jobId)
    // G4 — đây là cơ chế thật chặn `consumeAgentDecision` áp dụng LẦN NỮA sentinel
    // cuối output của CÙNG job này khi `job.finished` tới (xem decisionLoop.test.ts TC-11).
    expect(job?.metadata?.directDecisionApplied).toBe(true)
  })
})

describe('Xác thực token — TC-09/TC-10', () => {
  test('TC-09: không có token ⇒ 401 ở cả 3 route', async () => {
    seedTask('R0')
    expect((await status(undefined)).status).toBe(401)
    expect((await output(undefined)).status).toBe(401)
    expect((await decide(undefined, { action: 'halt' })).status).toBe(401)
  })

  test('TC-09: token sai/không tồn tại ⇒ 401', async () => {
    const res = await status('token-khong-ton-tai')
    expect(res.status).toBe(401)
    expect((await res.json()).error).toContain('invalid or expired')
  })

  // TC-10 — token cấp cho MỘT lượt orchestrator hết hiệu lực khi lượt đó kết
  // thúc (job xong / bị dừng); dùng lại đúng token cũ không còn điều khiển được.
  test('TC-10: token bị thu hồi sau khi orchestrator kết thúc lượt ⇒ dùng lại bị từ chối', async () => {
    seedTask('R2')
    const ref = { taskId: 'R2', root, projectId: '' }
    const token = mintOrchestratorToken(ref)

    // Xác nhận token còn dùng được trước khi thu hồi.
    expect((await status(token)).status).toBe(200)

    revokeOrchestratorTokensFor(ref)

    const res = await status(token)
    expect(res.status).toBe(401)
  })

  test('token của task A không điều khiển được task B (TC-08, ở lớp xác thực)', async () => {
    seedTask('R3', { current_phase: 'implementer' })
    seedTask('R4', { current_phase: 'reviewer' })
    const tokenA = tokenFor('R3')

    const res = await status(tokenA)
    const body = await res.json()
    // Token của R3 luôn resolve về R3 — không có tham số nào để trỏ sang R4.
    expect(body.currentPhase).toBe('implementer')
  })
})
