import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _resetEventBusForTest, on } from '../../../../src/backend/events/index.js'
import {
  _resetOrchestratorForTest,
  handleEvent,
  identifyTask,
} from '../../../../src/features/orchestrator/business/decisionLoop.js'
import { DECISION_SENTINEL } from '../../../../src/features/orchestrator/schemas/orchestrator.js'

// Bảng quyết định §4.2.4 + các bất biến chống vòng lặp. Chấm bằng event phát ra
// (`orchestrator.dispatched` / `orchestrator.halted`) — đúng bề mặt mà
// `test-spec.md` chỉ định cho nhóm B/D, không đọc biến nội bộ.

let home: string
let root: string
const savedEnv = { ...process.env }

interface Seen {
  type: string
  payload: Record<string, any>
}
const seen: Seen[] = []

function dispatched(): Seen[] {
  return seen.filter((e) => e.type === 'orchestrator.dispatched')
}
function haltReasons(): string[] {
  return seen.filter((e) => e.type === 'orchestrator.halted').map((e) => String(e.payload.reason))
}

function writePipeline(enabled: boolean) {
  fs.writeFileSync(
    path.join(root, 'pipeline.yaml'),
    [
      'version: 1',
      `orchestrator: { enabled: ${enabled}, agent: "a:orch" }`,
      'steps:',
      '  - { id: implementer, name: Implement, agent: "a:impl" }',
      '  - { id: reviewer, name: Review, agent: "a:rev" }',
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

/** Ghi thẳng một job record — rẻ hơn và tất định hơn là chạy job thật. */
function writeJob(id: string, metadata: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const dir = path.join(home, 'jobs')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify({
      id,
      status: 'failed',
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

function ev(type: string, payload: Record<string, unknown>) {
  return { type, at: new Date().toISOString(), payload }
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-orch-loop-home-'))
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-orch-loop-root-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(root, { recursive: true, force: true })
})
beforeEach(() => {
  _resetEventBusForTest()
  _resetOrchestratorForTest()
  seen.length = 0
  on('*', (e) => {
    seen.push({ type: e.type, payload: (e.payload ?? {}) as Record<string, any> })
  })
  writePipeline(true)
})
afterEach(() => _resetEventBusForTest())

describe('identifyTask — biết event nói về task nào', () => {
  test('lấy từ payload khi có devTeamRoot', () => {
    expect(identifyTask(ev('task.advanced', { taskId: 'T1', devTeamRoot: root }))).toMatchObject({
      taskId: 'T1',
      root,
    })
  })

  test('lấy từ metadata của job khi payload chỉ có jobId', () => {
    const id = writeJob('j-ident', { taskId: 'T9', pipelineStepId: 'implementer' })
    expect(identifyTask(ev('job.failed', { jobId: id }))).toMatchObject({ taskId: 'T9', root })
  })

  test('không suy ra được ⇒ null (không đoán bừa)', () => {
    expect(identifyTask(ev('task.advanced', { taskId: 'T1' }))).toBeNull()
  })
})

describe('chống tự kích & lọc event', () => {
  test('mọi event orchestrator.* bị bỏ qua', async () => {
    seedTask('L1')
    await handleEvent(ev('orchestrator.dispatched', { taskId: 'L1', devTeamRoot: root, stepId: 'implementer' }))
    expect(dispatched()).toHaveLength(0)
  })

  // Gate đang chờ NGƯỜI, không chờ orchestrator.
  test('hitl.pending không kích hoạt quyết định nào', async () => {
    seedTask('L2', { hitl_pending: 'hitl-1' })
    await handleEvent(ev('hitl.pending', { taskId: 'L2', devTeamRoot: root, gateId: 'hitl-1' }))
    expect(dispatched()).toHaveLength(0)
  })

  test('job.started / job.queued không kích hoạt gì', async () => {
    seedTask('L3')
    await handleEvent(ev('job.started', { taskId: 'L3', devTeamRoot: root }))
    await handleEvent(ev('job.queued', { taskId: 'L3', devTeamRoot: root }))
    expect(dispatched()).toHaveLength(0)
  })

  test('điều phối TẮT ⇒ không quyết định gì (tương thích ngược)', async () => {
    writePipeline(false)
    seedTask('L4', { orchestrator_enabled: false })
    await handleEvent(ev('task.advanced', { taskId: 'L4', devTeamRoot: root, currentPhase: 'reviewer' }))
    expect(dispatched()).toHaveLength(0)
  })

  test('đã halt ⇒ không quyết định gì', async () => {
    seedTask('L5', { orchestrator_halted: true })
    await handleEvent(ev('task.advanced', { taskId: 'L5', devTeamRoot: root, currentPhase: 'reviewer' }))
    expect(dispatched()).toHaveLength(0)
  })
})

describe('task.advanced — chuyển tiếp tuyến tính (KHÔNG tốn lượt LLM)', () => {
  test('pipeline đã completed ⇒ đánh mốc idle, không start gì', async () => {
    seedTask('M1', { current_phase: 'completed' })
    await handleEvent(ev('task.advanced', { taskId: 'M1', devTeamRoot: root, currentPhase: 'completed' }))
    const d = dispatched()
    expect(d).toHaveLength(1)
    expect(d[0].payload.action).toBe('idle')
  })
})

describe('job.failed — có mốc dừng, không đốt LLM vô hạn', () => {
  test('quá ngưỡng hỏi-vì-lỗi ⇒ halt kèm lý do', async () => {
    seedTask('N1')
    for (let i = 1; i <= 3; i++) {
      const id = writeJob(`n1-${i}`, { taskId: 'N1', pipelineStepId: 'implementer' }, { error: 'boom' })
      await handleEvent(ev('job.failed', { jobId: id, taskId: 'N1', devTeamRoot: root, error: 'boom' }))
    }
    expect(haltReasons().some((r) => r.startsWith('failure loop'))).toBe(true)
  })

  test('job không thuộc step nào ⇒ bỏ qua', async () => {
    seedTask('N2')
    const id = writeJob('n2', { taskId: 'N2' }, { error: 'boom' })
    await handleEvent(ev('job.failed', { jobId: id, taskId: 'N2', devTeamRoot: root }))
    expect(dispatched()).toHaveLength(0)
    expect(haltReasons()).toHaveLength(0)
  })

  // E5: orchestrator không được tự gọi lại chính nó — đó là cách sinh bão job.
  test('job của CHÍNH orchestrator lỗi ⇒ halt, không hỏi lại', async () => {
    seedTask('N3')
    const id = writeJob('n3', { taskId: 'N3', orchestratorJob: true, orchestratorTrigger: 'job_failed' })
    await handleEvent(ev('job.failed', { jobId: id, taskId: 'N3', devTeamRoot: root }))
    expect(haltReasons()).toContain('orchestrator_job_failed')
    expect(dispatched()).toHaveLength(0)
  })
})

describe('đọc quyết định từ job của orchestrator', () => {
  test('output không có sentinel ⇒ chỉ là hội thoại, không làm gì', async () => {
    seedTask('O1')
    const id = writeJob(
      'o1',
      { taskId: 'O1', orchestratorJob: true, orchestratorTrigger: 'chat' },
      { status: 'succeeded', stdout: 'Chào bạn, pipeline đang chờ reviewer.' },
    )
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'O1', devTeamRoot: root }))
    expect(dispatched()).toHaveLength(0)
    expect(haltReasons()).toHaveLength(0)
  })

  // Kết cục tệ nhất mà D1 cố tránh: không dispatch, không halt, không event.
  test('lượt QUYẾT ĐỊNH mà không có output ⇒ halt tường minh', async () => {
    seedTask('O2')
    const id = writeJob(
      'o2',
      { taskId: 'O2', orchestratorJob: true, orchestratorTrigger: 'job_failed' },
      { status: 'succeeded' },
    )
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'O2', devTeamRoot: root }))
    expect(haltReasons()).toContain('decision output unavailable')
  })

  test('stepId lạ ⇒ halt, KHÔNG dispatch bừa', async () => {
    seedTask('O3')
    const id = writeJob(
      'o3',
      { taskId: 'O3', orchestratorJob: true, orchestratorTrigger: 'gate_rejected' },
      { status: 'succeeded', stdout: `${DECISION_SENTINEL} {"action":"start","stepId":"khong-co"}` },
    )
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'O3', devTeamRoot: root }))
    expect(haltReasons().some((r) => r.includes('unknown stepId'))).toBe(true)
    expect(dispatched()).toHaveLength(0)
  })

  test('JSON hỏng ⇒ halt', async () => {
    seedTask('O4')
    const id = writeJob(
      'o4',
      { taskId: 'O4', orchestratorJob: true, orchestratorTrigger: 'gate_rejected' },
      { status: 'succeeded', stdout: `${DECISION_SENTINEL} {khong-phai-json` },
    )
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'O4', devTeamRoot: root }))
    expect(haltReasons().some((r) => r.includes('invalid decision'))).toBe(true)
  })

  test('agent trả halt ⇒ halt kèm đúng lý do của agent', async () => {
    seedTask('O5')
    const id = writeJob(
      'o5',
      { taskId: 'O5', orchestratorJob: true, orchestratorTrigger: 'gate_rejected' },
      { status: 'succeeded', stdout: `${DECISION_SENTINEL} {"action":"halt","reason":"cần người xem"}` },
    )
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'O5', devTeamRoot: root }))
    expect(haltReasons()).toContain('cần người xem')
  })
})

describe('cách ly giữa các task (TC-30)', () => {
  test('quyết định của task A không đụng task B', async () => {
    seedTask('P1')
    seedTask('P2')
    const id = writeJob('p1-fail', { taskId: 'P1', orchestratorJob: true, orchestratorTrigger: 'job_failed' }, { status: 'succeeded' })
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'P1', devTeamRoot: root }))

    const halts = seen.filter((e) => e.type === 'orchestrator.halted')
    expect(halts).toHaveLength(1)
    expect(halts[0].payload.taskId).toBe('P1')
    // B không bị đụng tới: state của nó không có cờ halt.
    const stateB = JSON.parse(fs.readFileSync(path.join(root, '.dev-state', 'P2.json'), 'utf8'))
    expect(stateB.orchestrator_halted).toBeUndefined()
  })
})
