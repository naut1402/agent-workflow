import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  assertStartAllowed,
  assertStartAllowedSync,
  applyOrchestratorConfigChange,
  resolveOrchestration,
  setOrchestratorEnabledFlag,
} from '../../../../src/features/monitor/business/tasks/startAuthority.js'

// Bài quan trọng nhất của tính năng: khi orchestrator đang điều phối thì
// **không đường nào** start được một step, trừ chính nó. Mỗi case dưới đây là
// một dòng của bảng "xử lý từng đường start" trong design §4.2.2.

let root: string

function writePipeline(enabled: boolean | unknown) {
  fs.writeFileSync(
    path.join(root, 'pipeline.yaml'),
    [
      'version: 1',
      ...(enabled === undefined ? [] : [`orchestrator: { enabled: ${JSON.stringify(enabled)}, agent: "a:orch" }`]),
      'steps:',
      '  - { id: implementer, name: Implement, agent: "a:impl" }',
      '  - { id: reviewer, name: Review, agent: "a:rev" }',
    ].join('\n'),
    'utf8',
  )
}

function seedTask(taskId: string, state: Record<string, unknown>) {
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.writeFileSync(
    path.join(root, '.dev-state', `${taskId}.json`),
    JSON.stringify({ task_id: taskId, current_phase: 'implementer', ...state }),
    'utf8',
  )
}

function readState(taskId: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(root, '.dev-state', `${taskId}.json`), 'utf8'))
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-orch-auth-'))
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
beforeEach(() => writePipeline(true))

describe('resolveOrchestration', () => {
  test('enabled + chưa halt ⇒ active', async () => {
    seedTask('T1', { orchestrator_enabled: true })
    expect(await resolveOrchestration(root, 'T1')).toMatchObject({
      enabled: true,
      halted: false,
      active: true,
      agent: 'a:orch',
    })
  })

  test('halted ⇒ KHÔNG active (quyền start trả về chế độ tay)', async () => {
    seedTask('T2', { orchestrator_enabled: true, orchestrator_halted: true })
    expect(await resolveOrchestration(root, 'T2')).toMatchObject({ enabled: true, halted: true, active: false })
  })

  test('pipeline không khai orchestrator ⇒ tắt (tương thích ngược)', async () => {
    writePipeline(undefined)
    seedTask('T3', {})
    expect(await resolveOrchestration(root, 'T3')).toMatchObject({ enabled: false, active: false })
  })

  test('awaitFlagSync tự chữa cờ cache lệch ngay trong lượt gọi', async () => {
    writePipeline(false)
    seedTask('T4', { orchestrator_enabled: true }) // cờ cũ, pipeline đã tắt
    await resolveOrchestration(root, 'T4', undefined, { awaitFlagSync: true })
    expect(readState('T4').orchestrator_enabled).toBe(false)
  })

  test('setOrchestratorEnabledFlag không đụng các field khác của state', async () => {
    seedTask('T5', { orchestrator_enabled: false, review_round: 3, name: 'giữ nguyên' })
    await setOrchestratorEnabledFlag(root, 'T5', true)
    const state = readState('T5')
    expect(state.orchestrator_enabled).toBe(true)
    expect(state.review_round).toBe(3)
    expect(state.name).toBe('giữ nguyên')
  })
})

describe('assertStartAllowed — điều phối BẬT', () => {
  beforeEach(() => seedTask('A1', { orchestrator_enabled: true }))

  test('S1 nút Run tay ⇒ 403 tường minh', async () => {
    expect(await assertStartAllowed(root, 'A1', 'manual')).toMatchObject({ allowed: false, status: 403 })
  })

  test('S2 chain sau job thành công ⇒ 403', async () => {
    expect(await assertStartAllowed(root, 'A1', 'chain')).toMatchObject({ allowed: false, status: 403 })
  })

  test('S5 automation ⇒ 403', async () => {
    expect(await assertStartAllowed(root, 'A1', 'automation')).toMatchObject({ allowed: false, status: 403 })
  })

  test('S6 POST /api/jobs ⇒ 403', async () => {
    expect(await assertStartAllowed(root, 'A1', 'api')).toMatchObject({ allowed: false, status: 403 })
  })

  test('chỉ orchestrator được đi qua', async () => {
    expect(await assertStartAllowed(root, 'A1', 'orchestrator')).toEqual({ allowed: true })
  })

  test('thông báo lỗi nêu rõ lý do, không phải mã trần', async () => {
    // Khẳng định thẳng trên object thay vì hẹp kiểu bằng `if (res.allowed) throw`:
    // `tsconfig` của repo để `strict: false`, mà không có `strictNullChecks` thì TS
    // KHÔNG narrow union theo discriminant boolean — `res.error` sẽ đỏ typecheck dù
    // logic đúng. Cách viết này cũng đồng bộ với các case `toMatchObject` ở trên.
    expect(await assertStartAllowed(root, 'A1', 'manual')).toMatchObject({
      allowed: false,
      error: expect.stringContaining('orchestrat'),
    })
  })
})

describe('assertStartAllowed — điều phối TẮT hoặc đã HALT ⇒ mọi đường mở như cũ', () => {
  test('tắt ⇒ manual/chain/automation/api đều qua', async () => {
    writePipeline(false)
    seedTask('B1', { orchestrator_enabled: false })
    for (const origin of ['manual', 'chain', 'automation', 'api'] as const) {
      expect(await assertStartAllowed(root, 'B1', origin)).toEqual({ allowed: true })
    }
  })

  // E11: halt là lối thoát — sau Stop người dùng phải chạy tay được.
  test('halted ⇒ chạy tay được trở lại', async () => {
    seedTask('B2', { orchestrator_enabled: true, orchestrator_halted: true })
    expect(await assertStartAllowed(root, 'B2', 'manual')).toEqual({ allowed: true })
  })
})

describe('assertStartAllowedSync — lưới an toàn cuối trong submitJob', () => {
  beforeEach(() => seedTask('C1', { orchestrator_enabled: true }))

  const stepJob = { taskId: 'C1', devTeamRoot: '', pipelineStepId: 'implementer' }

  test('job của một step khi đang điều phối ⇒ NÉM lỗi (không lọc im lặng)', () => {
    expect(() => assertStartAllowedSync({ ...stepJob, devTeamRoot: root })).toThrow(/orchestrator/)
  })

  test('vé dispatch của orchestrator đi qua', () => {
    expect(() =>
      assertStartAllowedSync({ ...stepJob, devTeamRoot: root, orchestratorDispatch: true }),
    ).not.toThrow()
  })

  // F2 — ngoại lệ "chat không giới hạn" của đề bài.
  test('chat đi qua vô điều kiện', () => {
    expect(() => assertStartAllowedSync({ ...stepJob, devTeamRoot: root, isChatFeedback: true })).not.toThrow()
  })

  test('job không thuộc step nào (quick-action, nl-chat) không bị soi', () => {
    expect(() => assertStartAllowedSync({ taskId: 'C1', devTeamRoot: root })).not.toThrow()
  })

  test('metadata thiếu thông tin ⇒ bỏ qua, không ném', () => {
    expect(() => assertStartAllowedSync(undefined)).not.toThrow()
    expect(() => assertStartAllowedSync({ pipelineStepId: 'implementer' })).not.toThrow()
  })

  test('đã halt ⇒ không ném (chế độ tay)', () => {
    seedTask('C2', { orchestrator_enabled: true, orchestrator_halted: true })
    expect(() =>
      assertStartAllowedSync({ taskId: 'C2', devTeamRoot: root, pipelineStepId: 'implementer' }),
    ).not.toThrow()
  })

  test('state đọc không được ⇒ không ném (không chặn nhầm)', () => {
    expect(() =>
      assertStartAllowedSync({ taskId: 'khong-ton-tai', devTeamRoot: root, pipelineStepId: 'implementer' }),
    ).not.toThrow()
  })
})

/* AC-5 — bật/tắt checkbox node điều phối rồi LƯU là cách reset trạng thái node.
 * Bề mặt chấm: state của task đọc lại được (đó cũng là thứ `GET /api/tasks` trả
 * về và thứ canvas monitor vẽ nhãn trạng thái từ đó). */
describe('applyOrchestratorConfigChange — lưu checkbox đồng bộ state (TC-25…TC-29)', () => {
  test('TC-25 — node đang DỪNG, lưu lại checkbox bật ⇒ cờ dừng bị xoá', async () => {
    seedTask('E1', {
      orchestrator_enabled: true,
      orchestrator_halted: true,
      orchestrator_halted_at: '2026-01-01T00:00:00.000Z',
    })
    await applyOrchestratorConfigChange(root, 'E1', true)

    const state = readState('E1')
    expect(state.orchestrator_enabled).toBe(true)
    expect(state.orchestrator_halted).toBe(false)
    expect(state.orchestrator_halted_at).toBeNull()
    // Và sau khi reset thì start lại được — đúng vế (c) của TC-25.
    expect(await resolveOrchestration(root, 'E1')).toMatchObject({ active: true, halted: false })
  })

  test('TC-26 — bỏ tick + lưu ⇒ pipeline về chế độ không điều phối', async () => {
    writePipeline(false)
    seedTask('E2', { orchestrator_enabled: true, orchestrator_halted: true })
    await applyOrchestratorConfigChange(root, 'E2', false)

    expect(readState('E2').orchestrator_enabled).toBe(false)
    expect(await resolveOrchestration(root, 'E2')).toMatchObject({ enabled: false, active: false })
    // Chạy tay mở lại như trước khi có tính năng.
    expect(await assertStartAllowed(root, 'E2', 'manual')).toEqual({ allowed: true })
  })

  test('TC-27 — bật lại sau khi đã tắt ⇒ trạng thái sạch, không kế thừa cờ dừng cũ', async () => {
    seedTask('E3', { orchestrator_enabled: false, orchestrator_halted: true })
    await applyOrchestratorConfigChange(root, 'E3', true)
    expect(readState('E3')).toMatchObject({ orchestrator_enabled: true, orchestrator_halted: false })
  })

  // TC-28 — chặn fix quá tay: reset là hệ quả của việc ĐỔI checkbox, không phải
  // của mọi lần lưu. State không lệch ⇒ không ghi lại gì (mtime giữ nguyên).
  test('TC-28 — lưu mà không đổi gì ⇒ state không bị viết lại', async () => {
    seedTask('E4', { orchestrator_enabled: true, review_round: 2 })
    const before = fs.statSync(path.join(root, '.dev-state', 'E4.json')).mtimeMs
    await applyOrchestratorConfigChange(root, 'E4', true)
    expect(fs.statSync(path.join(root, '.dev-state', 'E4.json')).mtimeMs).toBe(before)
    expect(readState('E4').review_round).toBe(2)
  })

  test('TC-29 — không đụng field nào khác của state', async () => {
    seedTask('E5', {
      orchestrator_enabled: false,
      orchestrator_halted: true,
      current_phase: 'reviewer',
      review_round: 3,
      hitl_pending: 'hitl-review',
    })
    await applyOrchestratorConfigChange(root, 'E5', true)
    expect(readState('E5')).toMatchObject({
      current_phase: 'reviewer',
      review_round: 3,
      hitl_pending: 'hitl-review',
      task_id: 'E5',
    })
  })

  test('task không có state ⇒ không tạo file rỗng, không ném', async () => {
    await applyOrchestratorConfigChange(root, 'khong-ton-tai', true)
    expect(fs.existsSync(path.join(root, '.dev-state', 'khong-ton-tai.json'))).toBe(false)
  })
})
