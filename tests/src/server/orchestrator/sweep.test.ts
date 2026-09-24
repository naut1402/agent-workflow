import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _resetEventBusForTest, on } from '../../../../src/backend/events/index.js'
import {
  _resetOrchestratorForTest,
  sweepStuckTasks,
} from '../../../../src/features/orchestrator/business/decisionLoop.js'

// D12: event bus là in-process và không bền — một lần restart dashboard đủ làm
// mất tín hiệu chuyển bước. Sweep là lưới cứu. Nó cũng là chỗ dễ biến thành tải
// I/O thường trực cho cả người dùng chưa bật tính năng, nên có case riêng cho
// "không bật ⇒ không quét gì".

let home: string
let root: string
const savedEnv = { ...process.env }
const dispatched: Record<string, any>[] = []

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

function seedTask(taskId: string, state: Record<string, unknown>) {
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tasks', taskId), { recursive: true })
  fs.writeFileSync(path.join(root, 'tasks', taskId, 'request.md'), '# r\n', 'utf8')
  fs.writeFileSync(
    path.join(root, '.dev-state', `${taskId}.json`),
    JSON.stringify({ task_id: taskId, ...state }),
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
      status: 'succeeded',
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

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-orch-sweep-home-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
})
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-orch-sweep-root-'))
  _resetEventBusForTest()
  _resetOrchestratorForTest()
  dispatched.length = 0
  // Thân hàm phải là block: `Array.push` trả `number`, mà `EventHandler` khai
  // `void | Promise<void>` — viết arrow rút gọn là trả giá trị vào chỗ không nhận.
  on('orchestrator.dispatched', (e) => {
    dispatched.push((e.payload ?? {}) as Record<string, any>)
  })
})
afterEach(() => {
  _resetEventBusForTest()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('sweepStuckTasks — chỉ đụng task đang được điều phối', () => {
  test('project không bật điều phối ⇒ không có ứng viên nào', async () => {
    writePipeline(false)
    seedTask('A', { current_phase: 'implementer' })
    seedTask('B', { current_phase: 'reviewer' })
    expect(await sweepStuckTasks(root, 'p1')).toBe(0)
    expect(dispatched).toHaveLength(0)
  })

  test('task treo thật (chưa có job nào) ⇒ nối lại đúng bước hiện tại', async () => {
    writePipeline(true)
    seedTask('S', { current_phase: 'implementer', orchestrator_enabled: true })
    expect(await sweepStuckTasks(root, 'p1')).toBe(1)
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]).toMatchObject({ stepId: 'implementer', reason: 'sweep_resume' })
  })

  test('task đang chờ gate ⇒ ĐẾM là orchestrated nhưng KHÔNG đụng tới', async () => {
    writePipeline(true)
    seedTask('G', { current_phase: 'implementer', orchestrator_enabled: true, hitl_pending: 'hitl-1' })
    expect(await sweepStuckTasks(root, 'p1')).toBe(1)
    expect(dispatched).toHaveLength(0)
  })

  test('task đã completed ⇒ bỏ qua', async () => {
    writePipeline(true)
    seedTask('D', { current_phase: 'completed', orchestrator_enabled: true })
    await sweepStuckTasks(root, 'p1')
    expect(dispatched).toHaveLength(0)
  })

  test('task đã archived ⇒ bỏ qua', async () => {
    writePipeline(true)
    seedTask('R', { current_phase: 'implementer', orchestrator_enabled: true, archived: true })
    await sweepStuckTasks(root, 'p1')
    expect(dispatched).toHaveLength(0)
  })

  test('task đã halt ⇒ bỏ qua (người dùng đã chủ động dừng)', async () => {
    writePipeline(true)
    seedTask('H', { current_phase: 'implementer', orchestrator_enabled: true, orchestrator_halted: true })
    expect(await sweepStuckTasks(root, 'p1')).toBe(0)
    expect(dispatched).toHaveLength(0)
  })

  test('cờ cache tắt ⇒ không đọc tới, dù pipeline bật', async () => {
    writePipeline(true)
    seedTask('X', { current_phase: 'implementer', orchestrator_enabled: false })
    expect(await sweepStuckTasks(root, 'p1')).toBe(0)
    expect(dispatched).toHaveLength(0)
  })

  test('không có thư mục .dev-state ⇒ không ném', async () => {
    writePipeline(true)
    expect(await sweepStuckTasks(root, 'p1')).toBe(0)
  })

  test('state file hỏng ⇒ bỏ qua, không kéo cả lượt quét xuống', async () => {
    writePipeline(true)
    fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
    fs.writeFileSync(path.join(root, '.dev-state', 'BAD.json'), '{ khong-phai-json', 'utf8')
    seedTask('OK', { current_phase: 'implementer', orchestrator_enabled: true })
    expect(await sweepStuckTasks(root, 'p1')).toBe(1)
    expect(dispatched).toHaveLength(1)
  })

  // Td2be3c3e [must, review.md] — job của `respawn` (metadata.respawn: true)
  // KHÔNG được đóng vai "job thật của bước hiện tại đã xong" — nếu không, sweep
  // sẽ tự đẩy `current_phase` dựa trên một phiên chạy thử riêng của agent, dù
  // chưa có job THẬT nào chạy cho bước đó theo luồng pipeline chính (đúng bất
  // biến `respawn` cam kết giữ — design.md §1/§4.4).
  test('job respawn succeeded trùng phase hiện tại ⇒ vẫn coi là treo thật, KHÔNG tự advance (regression)', async () => {
    writePipeline(true)
    seedTask('RSP', { current_phase: 'implementer', orchestrator_enabled: true })
    writeJob('rsp-1', { taskId: 'RSP', pipelineStepId: 'implementer', respawn: true }, { status: 'succeeded' })

    expect(await sweepStuckTasks(root, 'p1')).toBe(1)
    // Đúng hành vi "chưa có job nào" — dispatch resume lại CHÍNH implementer,
    // không phải advance sang reviewer.
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]).toMatchObject({ stepId: 'implementer', reason: 'sweep_resume' })
  })
})
