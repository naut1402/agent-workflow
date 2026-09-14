import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/backend/apiServer.js'
import type { RegistryContext } from '../../../../src/backend/http/types.js'
import {
  listJobs,
  registerProvider,
  upsertConnection,
  upsertRunner,
} from '../../../../src/features/runner/business/index.js'
import type { ExecuteRequest, ExecuteResult, RunnerProvider } from '../../../../src/features/runner/business/types.js'
import { ORCHESTRATOR_STEP_ID } from '../../../../src/shared/lib/orchestrator.js'

/**
 * Ba kịch bản của `request.md` đi qua **đúng các endpoint UI gọi**:
 *
 *   ① start pipeline có node điều phối        → PUT /api/task-orchestrator
 *   ② chat với node                           → POST /api/tasks/:id/feedback
 *   ③ bật/tắt checkbox rồi Lưu ⇒ reset        → POST /api/pipeline-config-write
 *
 * Bề mặt chấm là `.dev-state` đọc lại được (thứ `GET /api/tasks` trả về và thứ
 * canvas monitor vẽ trạng thái node từ đó) cộng job của node — không đọc biến
 * nội bộ nào.
 */

const PROVIDER_ID = 'stub-orch-node-route'
const RUNNER_ID = 'stub-runner-orch-node'

const stubProvider: RunnerProvider = {
  providerId: PROVIDER_ID,
  validateRunnerConfig: () => ({ ok: true, errors: [] }),
  validateCredential: () => ({ ok: true, errors: [] }),
  capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }),
  async execute(_req: ExecuteRequest): Promise<ExecuteResult> {
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

function pipelineBody(orchestrator?: { enabled: boolean; agent?: string }) {
  return {
    version: 1,
    ...(orchestrator ? { orchestrator: { agent: 'a:orch', ...orchestrator } } : {}),
    steps: [
      { id: 'investigator', agent: ' ' },
      { id: 'implementer', agent: ' ' },
    ],
  }
}

/** Lưu pipeline của task — đúng đường nút Lưu trong editor đi. */
async function savePipeline(taskId: string, orchestrator?: { enabled: boolean; agent?: string }) {
  const res = await app.request('/api/pipeline-config-write', {
    method: 'POST',
    body: JSON.stringify({ scope: 'task', taskId, pipeline: pipelineBody(orchestrator) }),
  })
  expect(res.status).toBe(200)
  return res
}

function stateFileOf(taskId: string) {
  return path.join(root, '.dev-state', `${taskId}.json`)
}
function readStateFile(taskId: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(stateFileOf(taskId), 'utf8'))
}

function seedTask(taskId: string, state: Record<string, unknown> = {}) {
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tasks', taskId), { recursive: true })
  fs.writeFileSync(
    stateFileOf(taskId),
    JSON.stringify({ task_id: taskId, current_phase: 'investigator', ...state }, null, 2),
    'utf8',
  )
  fs.writeFileSync(path.join(root, 'tasks', taskId, 'request.md'), 'làm việc X', 'utf8')
}

/** Nút Run / Stop trên node điều phối — cùng một endpoint, khác cờ. */
async function orchestratorButton(taskId: string, halted: boolean) {
  const mtime = fs.statSync(stateFileOf(taskId)).mtimeMs
  return app.request(`/api/task-orchestrator?id=${taskId}`, {
    method: 'PUT',
    body: JSON.stringify({ halted, mtime }),
  })
}

function orchestratorJobs(taskId: string) {
  return listJobs(200).filter((j) => j.metadata?.taskId === taskId && j.metadata?.orchestratorJob === true)
}

/** Lượt agent là bất đồng bộ (endpoint không giữ request chờ job). */
async function waitFor<T>(read: () => T, ok: (v: T) => boolean, tries = 200): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const v = read()
    if (ok(v)) return v
    await new Promise((r) => setTimeout(r, 5))
  }
  return read()
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-orch-node-route-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = path.join(root, '.home')
  registerProvider(stubProvider)
  upsertConnection({ id: 'stub-conn-orch-node', kind: 'local-console', providerId: PROVIDER_ID, cliPath: 'stub' })
  upsertRunner({ id: RUNNER_ID, connectionId: 'stub-conn-orch-node', config: {} })
  fs.writeFileSync(path.join(root, 'pipeline.yaml'), JSON.stringify(pipelineBody()), 'utf8')
  app = await createApp(fakeCtx())
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(root, { recursive: true, force: true })
})
beforeEach(() => {
  fs.writeFileSync(path.join(root, 'pipeline.yaml'), JSON.stringify(pipelineBody()), 'utf8')
})

describe('③ lưu checkbox node điều phối ⇒ state đồng bộ và reset (TC-25…TC-28)', () => {
  test('TC-02 — bật checkbox cho task đã tồn tại ⇒ cờ điều phối được ghi ngay', async () => {
    seedTask('R1')
    await savePipeline('R1', { enabled: true })
    expect(readStateFile('R1').orchestrator_enabled).toBe(true)
  })

  test('TC-25 — node đang DỪNG, lưu lại checkbox ⇒ trạng thái dừng bị xoá', async () => {
    seedTask('R2', { orchestrator_enabled: true, orchestrator_halted: true })
    await savePipeline('R2', { enabled: true })

    const state = readStateFile('R2')
    expect(state.orchestrator_halted).toBe(false)
    expect(state.orchestrator_enabled).toBe(true)
  })

  test('TC-26 — bỏ tick + Lưu ⇒ YAML không còn trạng thái bật, state theo cùng', async () => {
    seedTask('R3', { orchestrator_enabled: true, orchestrator_halted: true })
    await savePipeline('R3', { enabled: false })

    expect(readStateFile('R3').orchestrator_enabled).toBe(false)
    const yaml = fs.readFileSync(path.join(root, 'tasks', 'R3', 'pipeline.yaml'), 'utf8')
    expect(yaml).toContain('enabled: false')
  })

  test('TC-27 — bật lại sau khi đã tắt ⇒ không kế thừa cờ dừng cũ', async () => {
    seedTask('R4', { orchestrator_enabled: false, orchestrator_halted: true })
    await savePipeline('R4', { enabled: true })
    expect(readStateFile('R4')).toMatchObject({ orchestrator_enabled: true, orchestrator_halted: false })
  })

  // TC-28 chặn fix quá tay: reset là hệ quả của việc ĐỔI checkbox, không phải
  // của mọi lần lưu. Tiến độ pipeline và cờ gate phải nguyên vẹn.
  test('TC-28 — lưu mà không đụng checkbox ⇒ tiến độ pipeline giữ nguyên', async () => {
    seedTask('R5', { orchestrator_enabled: true, current_phase: 'implementer', review_round: 2 })
    await savePipeline('R5', { enabled: true })

    expect(readStateFile('R5')).toMatchObject({
      current_phase: 'implementer',
      review_round: 2,
      orchestrator_enabled: true,
    })
  })

  test('TC-29 — round-trip: lưu hai lần liên tiếp cho ra YAML y hệt', async () => {
    seedTask('R6')
    await savePipeline('R6', { enabled: true })
    const first = fs.readFileSync(path.join(root, 'tasks', 'R6', 'pipeline.yaml'), 'utf8')
    await savePipeline('R6', { enabled: true })
    expect(fs.readFileSync(path.join(root, 'tasks', 'R6', 'pipeline.yaml'), 'utf8')).toBe(first)
  })

  // TC-32 — pipeline chưa từng đụng tính năng này không tự mọc trạng thái bật.
  test('TC-32 — lưu pipeline không khai orchestrator ⇒ cờ vẫn tắt', async () => {
    seedTask('R7')
    await savePipeline('R7')
    expect(readStateFile('R7').orchestrator_enabled).toBe(false)
  })
})

describe('① nút Run/Stop trên node điều phối (TC-01, TC-04)', () => {
  test('Run ⇒ xoá cờ dừng và giao một lượt cho node', async () => {
    seedTask('S1', { orchestrator_enabled: true, orchestrator_halted: true })
    await savePipeline('S1', { enabled: true })

    const res = await orchestratorButton('S1', false)
    expect(res.status).toBe(200)
    expect(readStateFile('S1').orchestrator_halted).toBe(false)

    // Chấm "có lượt được giao" + lượt đó thuộc về NODE. 🚫 Không chấm số lượt ở
    // đây: vòng lặp điều phối vẫn sống trong process test, nên một lượt hỏng có
    // thể kéo theo lưới tất định rồi một lượt nữa — đúng hành vi thiết kế. Bất
    // biến "một bước xong = đúng một lượt" được chấm tất định ở
    // `tests/src/server/orchestrator/decisionLoop.test.ts`.
    const turns = await waitFor(
      () => orchestratorJobs('S1'),
      (list) => list.length > 0,
    )
    expect(turns.length).toBeGreaterThan(0)
    expect(turns[0].metadata?.stepId).toBe(ORCHESTRATOR_STEP_ID)
    expect(turns[0].metadata?.pipelineStepId).toBeUndefined()
  })

  test('Stop ⇒ ghi cờ dừng, và KHÔNG giao lượt nào', async () => {
    seedTask('S2', { orchestrator_enabled: true })
    await savePipeline('S2', { enabled: true })

    expect((await orchestratorButton('S2', true)).status).toBe(200)
    expect(readStateFile('S2').orchestrator_halted).toBe(true)
    expect(orchestratorJobs('S2')).toHaveLength(0)
  })

  // TC-04: "bấm dừng thì hoàn toàn không thể start lại" là triệu chứng ①. Chuỗi
  // dừng → chạy lại phải lặp được 2 lần liên tiếp mà vẫn đúng.
  test('TC-04 — dừng rồi chạy lại, lặp 2 vòng vẫn đúng', async () => {
    seedTask('S3', { orchestrator_enabled: true })
    await savePipeline('S3', { enabled: true })

    for (let round = 1; round <= 2; round++) {
      expect((await orchestratorButton('S3', true)).status).toBe(200)
      expect(readStateFile('S3').orchestrator_halted).toBe(true)

      expect((await orchestratorButton('S3', false)).status).toBe(200)
      expect(readStateFile('S3').orchestrator_halted).toBe(false)
    }
  })

  // TC-30: thao tác dựa trên dữ liệu cũ (tab thứ hai) không được tạo trạng thái hỏng.
  test('TC-30 — mtime cũ ⇒ 409 tường minh, state không đổi', async () => {
    seedTask('S4', { orchestrator_enabled: true })
    await savePipeline('S4', { enabled: true })

    const res = await app.request('/api/task-orchestrator?id=S4', {
      method: 'PUT',
      body: JSON.stringify({ halted: true, mtime: 1 }),
    })
    expect(res.status).toBe(409)
    expect(readStateFile('S4').orchestrator_halted).toBeFalsy()
  })

  test('task id có ký tự lạ ⇒ 400, không chạm filesystem', async () => {
    const res = await app.request('/api/task-orchestrator?id=../../etc', {
      method: 'PUT',
      body: JSON.stringify({ halted: true, mtime: 1 }),
    })
    expect(res.status).toBe(400)
  })
})

describe('② chat với node điều phối (TC-13, TC-18, TC-19)', () => {
  test('tin nhắn đi vào lượt của NODE, không rơi vào job của step nào', async () => {
    seedTask('C1', { orchestrator_enabled: true })
    await savePipeline('C1', { enabled: true })

    const res = await app.request('/api/tasks/C1/feedback', {
      method: 'POST',
      body: JSON.stringify({ feedback: 'PING-abc123', stepId: ORCHESTRATOR_STEP_ID }),
    })
    expect(res.status).toBe(201)

    const { job } = await res.json()
    expect(job.metadata?.orchestratorJob).toBe(true)
    expect(job.metadata?.orchestratorTrigger).toBe('chat')
    expect(job.metadata?.pipelineStepId).toBeUndefined()
    expect(job.userPrompt).toContain('PING-abc123')
  })

  // TC-18 — chat khi node đang dừng: kết quả phải TƯỜNG MINH. Ở đây sản phẩm
  // chọn hướng "chat được và việc chat đưa node trở lại hoạt động".
  test('TC-18 — chat khi node đang DỪNG ⇒ node hoạt động lại, không im lặng', async () => {
    seedTask('C2', { orchestrator_enabled: true, orchestrator_halted: true })
    await savePipeline('C2', { enabled: true })
    // Lưu lại đã xoá cờ dừng (TC-25) — đặt lại để đúng bối cảnh case này.
    await orchestratorButton('C2', true)
    expect(readStateFile('C2').orchestrator_halted).toBe(true)

    const res = await app.request('/api/tasks/C2/feedback', {
      method: 'POST',
      body: JSON.stringify({ feedback: 'chạy tiếp giúp tôi', stepId: ORCHESTRATOR_STEP_ID }),
    })
    expect(res.status).toBe(201)
    expect(readStateFile('C2').orchestrator_halted).toBe(false)
  })

  // TC-19 — pipeline chưa start: phải có phản hồi tường minh, 🚫 không lỗi runtime.
  test('TC-19 — chat khi chưa start ⇒ vẫn mở được lượt, không 5xx', async () => {
    seedTask('C3', { orchestrator_enabled: true })
    await savePipeline('C3', { enabled: true })

    const res = await app.request('/api/tasks/C3/feedback', {
      method: 'POST',
      body: JSON.stringify({ feedback: 'pipeline này sẽ chạy gì?', stepId: ORCHESTRATOR_STEP_ID }),
    })
    expect(res.status).toBeLessThan(500)
    expect([201, 400, 409]).toContain(res.status)
  })

  // AC-6 — điều phối tắt thì chat với node điều phối không được lẳng lặng đi vào
  // phiên của step nào; nó phải bị từ chối tường minh.
  test('điều phối TẮT ⇒ chat với node bị từ chối tường minh', async () => {
    seedTask('C4')
    await savePipeline('C4', { enabled: false })

    const res = await app.request('/api/tasks/C4/feedback', {
      method: 'POST',
      body: JSON.stringify({ feedback: 'có ai ở đó không', stepId: ORCHESTRATOR_STEP_ID }),
    })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('orchestrator') })
  })
})
