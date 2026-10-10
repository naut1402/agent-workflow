import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _resetEventBusForTest, on } from '../../../../src/backend/events/index.js'
import {
  _resetOrchestratorForTest,
  handleEvent,
  identifyTask,
  readTaskPhase,
  stepResultOf,
} from '../../../../src/features/orchestrator/business/decisionLoop.js'
import { DECISION_SENTINEL } from '../../../../src/features/orchestrator/schemas/orchestrator.js'
import { listJobs } from '../../../../src/features/runner/business/index.js'
import { createFileDriver } from '../../../../src/features/knowledge/business/fileDriver.js'

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
      // Gate khai đúng ở `reviewer` — mọi fixture `hitl_pending: 'hitl-review'`
      // trong file này giả định "cổng đang chờ người" phải là một cổng THẬT SỰ
      // còn sống trên pipeline hiện tại, không chỉ là cờ đơn độc trên state
      // (đó chính xác là điều `readTaskPhase` giờ đòi hỏi, khớp `resolveHitlPending`
      // mà `/api/tasks` đã dùng — xem `shared/lib/phase.ts`).
      '  - { id: reviewer, name: Review, agent: "a:rev", hitl: { mode: manual, gate_id: hitl-review } }',
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

/*
 * Td735db94 — TC-01/TC-02: đổi pipeline gate → không-gate phải được phản ánh
 * NGAY qua `readTaskPhase` (nguồn mà `decide()`/`askAgent`/`applyStart` và 2
 * route REST orchestrator dùng chung), không cần đợi một `hitl.resolved`
 * (`reason: 'pipeline_changed'`) chạy qua trước — đó đúng là gap: test dòng
 * 493-505 (mục "cổng HITL" ở trên) chỉ xác nhận decisionLoop bỏ qua sự kiện đó
 * SAU KHI nó đã được phát, chưa test việc tự đọc đúng khi CHƯA có event nào.
 */
describe('readTaskPhase — chuẩn hoá gate theo pipeline SỐNG, không phụ thuộc event trước đó (TC-01/TC-02)', () => {
  test('hitl_pending trỏ gate đã bị gỡ khỏi pipeline hiện tại ⇒ gatePending biến mất ngay lập tức', async () => {
    // `writePipeline(true)` (beforeEach) khai gate `hitl-review` ở `reviewer` —
    // đổi sang một pipeline không còn gate nào, y hệt kịch bản bug report.
    fs.writeFileSync(
      path.join(root, 'pipeline.yaml'),
      [
        'version: 1',
        'orchestrator: { enabled: true, agent: "a:orch" }',
        'steps:',
        '  - { id: implementer, name: Implement, agent: "a:impl" }',
        '  - { id: reviewer, name: Review, agent: "a:rev" }',
      ].join('\n'),
      'utf8',
    )
    seedTask('W1', { current_phase: 'reviewer', hitl_pending: 'hitl-review' })
    const at = await readTaskPhase(root, 'W1')
    expect(at.gatePending).toBeUndefined()
  })

  test('gate vẫn còn khai đúng ở step hiện tại ⇒ gatePending giữ nguyên (đối chứng — không vá lố, không nhả gate thật)', async () => {
    // Pipeline mặc định của `beforeEach` đã khai `hitl-review` ở `reviewer`.
    seedTask('W2', { current_phase: 'reviewer', hitl_pending: 'hitl-review' })
    const at = await readTaskPhase(root, 'W2')
    expect(at.gatePending).toBe('hitl-review')
  })

  test('pipeline task-scope (không phải global) cũng được đọc SỐNG — gỡ gate qua override riêng task vẫn nhận ra ngay', async () => {
    fs.mkdirSync(path.join(root, 'tasks', 'W3'), { recursive: true })
    // `steps_replace: true` — đúng cách `writePipelineConfig` ghi override scope
    // `task` qua editor thật (controller.ts:164): thay NGUYÊN mảng steps, không
    // patch từng field theo id (patch giữ nguyên `hitl` cũ nếu step mới không
    // khai lại field đó — xem `mergeStep`/`patchSteps`).
    fs.writeFileSync(
      path.join(root, 'tasks', 'W3', 'pipeline.yaml'),
      [
        'version: 1',
        'steps_replace: true',
        'steps:',
        '  - { id: implementer, name: Implement, agent: "a:impl" }',
        '  - { id: reviewer, name: Review, agent: "a:rev" }',
      ].join('\n'),
      'utf8',
    )
    seedTask('W3', { current_phase: 'reviewer', hitl_pending: 'hitl-review' })
    const at = await readTaskPhase(root, 'W3')
    expect(at.gatePending).toBeUndefined()
  })

  test('pipeline task-scope không đọc được (untrusted) ⇒ fail-closed, giữ nguyên gate cũ thay vì nhả bừa (TC-08)', async () => {
    fs.mkdirSync(path.join(root, 'tasks', 'W4'), { recursive: true })
    // YAML hỏng cú pháp — `loadPipelineConfig` phải trả cấu hình `untrusted`.
    fs.writeFileSync(path.join(root, 'tasks', 'W4', 'pipeline.yaml'), 'steps: [ {', 'utf8')
    seedTask('W4', { current_phase: 'reviewer', hitl_pending: 'hitl-review' })
    const at = await readTaskPhase(root, 'W4')
    expect(at.gatePending).toBe('hitl-review')
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

  // TC-11 — `POST /api/orchestrator/decide` đánh dấu `directDecisionApplied`
  // trên job TRƯỚC khi thi hành quyết định (xem `orchestratorApi.route.test.ts`).
  // Khi job đó sau này `job.finished`, sentinel cuối output của CÙNG lượt không
  // được áp dụng lần nữa — nếu không, một quyết định gọi qua API sẽ bị dispatch
  // hai lần (một lần lúc gọi API, một lần nữa khi đọc lại dòng JSON cuối output).
  test('TC-11: đã áp dụng qua API (directDecisionApplied) ⇒ bỏ qua sentinel cùng lượt, không dispatch lần 2', async () => {
    seedTask('O6')
    const id = writeJob(
      'o6',
      { taskId: 'O6', orchestratorJob: true, orchestratorTrigger: 'step_finished', directDecisionApplied: true },
      { status: 'succeeded', stdout: `${DECISION_SENTINEL} {"action":"start","stepId":"reviewer"}` },
    )
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'O6', devTeamRoot: root }))
    expect(dispatched()).toHaveLength(0)
    expect(haltReasons()).toHaveLength(0)
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

/* ────────────────────────────────────────────────────────────────────────────
 * AC-1/AC-2/AC-4 — mốc mở lượt agent.
 *
 * Bề mặt chấm là **job của node điều phối** (đọc lại được qua API job / log của
 * task): một lượt = một job mang `orchestratorJob: true`. Job giả do `writeJob`
 * seed không có `userPrompt`, nên lọc theo trường đó tách được "lượt thật vừa
 * mở" khỏi "bối cảnh đã seed".
 * ──────────────────────────────────────────────────────────────────────────── */

/** Lượt agent đã được mở cho task — job của node, theo thứ tự mới nhất trước. */
function turnsOf(taskId: string): any[] {
  return listJobs(200).filter(
    (j) => j.metadata?.taskId === taskId && j.metadata?.orchestratorJob === true && j.userPrompt,
  )
}

function triggersOf(taskId: string): string[] {
  return turnsOf(taskId).map((j) => String(j.metadata?.orchestratorTrigger))
}

/** Job step đã chạy xong — mốc duy nhất mở lượt agent. */
function finishedStepJob(
  id: string,
  taskId: string,
  meta: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) {
  return writeJob(
    id,
    { taskId, pipelineStepId: 'implementer', ...meta },
    { status: 'succeeded', stdout: 'step-1 đã xong', artifactsFound: ['design.md'], ...extra },
  )
}

describe('job.finished của một step ⇒ ĐÚNG MỘT lượt agent (AC-2)', () => {
  test('step xong ⇒ mở lượt, job mang đúng trigger và KHÔNG mang pipelineStepId', async () => {
    seedTask('Q1', { current_phase: 'reviewer' })
    const id = finishedStepJob('q1', 'Q1')
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'Q1', devTeamRoot: root }))

    const turns = turnsOf('Q1')
    expect(turns).toHaveLength(1)
    expect(turns[0].metadata.orchestratorTrigger).toBe('step_finished')
    expect(turns[0].metadata.stepId).toBe('__orchestrator__')
    // Job của node KHÔNG phải một step: mang `pipelineStepId` là đẩy cursor khi xong.
    expect(turns[0].metadata.pipelineStepId).toBeUndefined()
    // Kết quả step vừa xong phải nằm trong lượt — đây là "context đầy đủ" của AC-3.
    expect(turns[0].userPrompt).toContain('step-1 đã xong')
    expect(turns[0].userPrompt).toContain('design.md')
  })

  // E1 — nhánh này phải đứng TRƯỚC bộ lọc ACTIONABLE, nếu không mỗi lượt agent
  // tự kích lượt kế: đó là cách sinh bão job (TC-24).
  test('job.finished của CHÍNH node điều phối ⇒ không mở lượt mới', async () => {
    seedTask('Q2', { current_phase: 'reviewer' })
    const id = writeJob(
      'q2',
      { taskId: 'Q2', orchestratorJob: true, orchestratorTrigger: 'chat' },
      { status: 'succeeded', stdout: 'chỉ là trò chuyện' },
    )
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'Q2', devTeamRoot: root }))
    expect(turnsOf('Q2')).toHaveLength(0)
  })

  // E2 — lượt chat của người dùng kế thừa `pipelineStepId` của job cha nhưng
  // không đẩy pipeline, nên nó cũng không được tính là "bước xong".
  test('lượt chat với node step ⇒ không mở lượt (TC-17)', async () => {
    seedTask('Q3', { current_phase: 'reviewer' })
    const id = finishedStepJob('q3', 'Q3', { isChatFeedback: true })
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'Q3', devTeamRoot: root }))
    expect(turnsOf('Q3')).toHaveLength(0)
  })

  test('lượt resume DO node điều phối gửi vẫn là bước xong ⇒ mở lượt', async () => {
    seedTask('Q4', { current_phase: 'reviewer' })
    const id = finishedStepJob('q4', 'Q4', { isChatFeedback: true, orchestratorResume: true })
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'Q4', devTeamRoot: root }))
    expect(turnsOf('Q4')).toHaveLength(1)
  })

  // E3 — job áp artifact không phải một bước của pipeline.
  test('job applyTarget ⇒ không mở lượt', async () => {
    seedTask('Q5', { current_phase: 'reviewer' })
    const id = finishedStepJob('q5', 'Q5', {}, { applyTarget: '/tmp/x.md' })
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'Q5', devTeamRoot: root }))
    expect(turnsOf('Q5')).toHaveLength(0)
  })

  test('job không thuộc step nào ⇒ không mở lượt', async () => {
    seedTask('Q6', { current_phase: 'reviewer' })
    const id = writeJob('q6', { taskId: 'Q6' }, { status: 'succeeded' })
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'Q6', devTeamRoot: root }))
    expect(turnsOf('Q6')).toHaveLength(0)
  })

  // TC-24 — `task.advanced` đi kèm cùng lần chạy job; tính nó là một mốc nữa là
  // hai lượt cho một lần chuyển bước.
  test('task.advanced giữa chừng ⇒ KHÔNG mở lượt (một bước xong = một lượt)', async () => {
    seedTask('Q7', { current_phase: 'reviewer' })
    await handleEvent(ev('task.advanced', { taskId: 'Q7', devTeamRoot: root, currentPhase: 'reviewer' }))
    expect(turnsOf('Q7')).toHaveLength(0)
    expect(dispatched()).toHaveLength(0)
  })

  test('step cuối xong ⇒ lượt tổng kết mang trigger pipeline_completed', async () => {
    seedTask('Q8', { current_phase: 'completed' })
    const id = finishedStepJob('q8', 'Q8')
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'Q8', devTeamRoot: root }))
    expect(triggersOf('Q8')).toEqual(['pipeline_completed'])
  })

  // AC-6 — pipeline không bật điều phối phải chạy y như trước: không lượt LLM nào.
  test('điều phối TẮT ⇒ step xong cũng không mở lượt nào (TC-31)', async () => {
    writePipeline(false)
    seedTask('Q9', { current_phase: 'reviewer', orchestrator_enabled: false })
    const id = finishedStepJob('q9', 'Q9')
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'Q9', devTeamRoot: root }))
    expect(turnsOf('Q9')).toHaveLength(0)
  })

  test('đã dừng (halted) ⇒ step xong không mở lượt (TC-04a)', async () => {
    seedTask('Q10', { current_phase: 'reviewer', orchestrator_halted: true })
    const id = finishedStepJob('q10', 'Q10')
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'Q10', devTeamRoot: root }))
    expect(turnsOf('Q10')).toHaveLength(0)
  })
})

// G5 — automation bị `askAgent` từ chối (409) vì task đang được điều phối,
// nên phát `orchestrator.start_requested` xin lại một lượt quyết định. Trước
// fix, guard chống tự-kích ở `handleEvent` nuốt mất event này vì nó rơi vào
// tiền tố `orchestrator.*`.
describe('orchestrator.start_requested — trả nợ G5', () => {
  test('có pending step, orchestration đang active ⇒ mở đúng 1 lượt, trigger manual_start', async () => {
    seedTask('M1', { current_phase: 'reviewer' })
    await handleEvent(ev('orchestrator.start_requested', { taskId: 'M1', devTeamRoot: root }))
    expect(turnsOf('M1')).toHaveLength(1)
    expect(triggersOf('M1')).toEqual(['manual_start'])
  })

  test('orchestration không active ⇒ không mở lượt nào', async () => {
    writePipeline(false)
    seedTask('M2', { current_phase: 'reviewer', orchestrator_enabled: false })
    await handleEvent(ev('orchestrator.start_requested', { taskId: 'M2', devTeamRoot: root }))
    expect(turnsOf('M2')).toHaveLength(0)
  })

  test('không còn pending step (completed) ⇒ không mở lượt nào', async () => {
    seedTask('M3', { current_phase: 'completed' })
    await handleEvent(ev('orchestrator.start_requested', { taskId: 'M3', devTeamRoot: root }))
    expect(turnsOf('M3')).toHaveLength(0)
  })

  test('đang có gate chờ người ⇒ không mở lượt nào', async () => {
    seedTask('M4', { current_phase: 'reviewer', hitl_pending: 'hitl-review' })
    await handleEvent(ev('orchestrator.start_requested', { taskId: 'M4', devTeamRoot: root }))
    expect(turnsOf('M4')).toHaveLength(0)
  })
})

describe('cổng HITL — node vẫn có lượt, nhưng KHÔNG vượt cổng (AC-4)', () => {
  // TC-20: "step xong, cổng pending, node hoàn toàn không có động tĩnh" là đúng
  // triệu chứng ② của đề bài.
  test('step xong + cổng đang chờ người ⇒ vẫn mở lượt, và lượt biết có cổng', async () => {
    seedTask('S1', { current_phase: 'reviewer', hitl_pending: 'hitl-review' })
    const id = finishedStepJob('s1', 'S1')
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'S1', devTeamRoot: root }))

    const turns = turnsOf('S1')
    expect(turns).toHaveLength(1)
    expect(turns[0].userPrompt).toContain('hitl-review')
  })

  // TC-21 — bất biến an toàn: agent đòi chạy step kế trong lúc cổng chờ người thì
  // bị hạ xuống tóm tắt, KHÔNG có step nào được start.
  test('agent trả start trong lúc cổng chờ ⇒ hạ xuống summary, không start step nào', async () => {
    seedTask('S2', { current_phase: 'reviewer', hitl_pending: 'hitl-review' })
    const id = writeJob(
      's2',
      { taskId: 'S2', orchestratorJob: true, orchestratorTrigger: 'step_finished' },
      { status: 'succeeded', stdout: `${DECISION_SENTINEL} {"action":"start","stepId":"reviewer"}` },
    )
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'S2', devTeamRoot: root }))

    const d = dispatched()
    expect(d).toHaveLength(1)
    expect(d[0].payload.action).toBe('summary')
    expect(d.some((e) => e.payload.action === 'start')).toBe(false)
  })

  test('agent trả summary ⇒ ghi nhận quan sát được, không chạy step nào', async () => {
    seedTask('S3', { current_phase: 'reviewer', hitl_pending: 'hitl-review' })
    const id = writeJob(
      's3',
      { taskId: 'S3', orchestratorJob: true, orchestratorTrigger: 'step_finished' },
      {
        status: 'succeeded',
        stdout: `${DECISION_SENTINEL} {"action":"summary","summary":"đã xong implementer","reason":"chờ người duyệt"}`,
      },
    )
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'S3', devTeamRoot: root }))

    const d = dispatched()
    expect(d).toHaveLength(1)
    expect(d[0].payload.action).toBe('summary')
    expect(d[0].payload.reason).toBe('chờ người duyệt')
    expect(haltReasons()).toHaveLength(0)
  })

  test('người duyệt cổng ⇒ đúng một lượt, mang trigger gate_approved (TC-22)', async () => {
    seedTask('S4', { current_phase: 'reviewer' })
    await handleEvent(
      ev('hitl.resolved', { taskId: 'S4', devTeamRoot: root, action: 'approve', currentPhase: 'reviewer' }),
    )
    expect(triggersOf('S4')).toEqual(['gate_approved'])
  })

  test('người từ chối cổng ⇒ đúng một lượt, mang trigger gate_rejected (TC-23)', async () => {
    seedTask('S5', { current_phase: 'implementer' })
    fs.writeFileSync(
      path.join(root, 'tasks', 'S5', 'hitl-feedback.md'),
      '## 2026-01-01 — hitl-review\n\nThiếu test cho nhánh lỗi.\n',
      'utf8',
    )
    await handleEvent(
      ev('hitl.resolved', { taskId: 'S5', devTeamRoot: root, action: 'reject', currentPhase: 'implementer' }),
    )
    const turns = turnsOf('S5')
    expect(turns).toHaveLength(1)
    expect(turns[0].metadata.orchestratorTrigger).toBe('gate_rejected')
    // Phản hồi của người duyệt đi NGUYÊN VĂN vào lượt — đó là thứ agent phải đọc.
    expect(turns[0].userPrompt).toContain('Thiếu test cho nhánh lỗi.')
  })

  // Gate bị hệ thống tự huỷ vì pipeline đổi hình dạng — không phải quyết định
  // của người, không có gì để điều phối.
  test('gate bị huỷ do pipeline đổi ⇒ không mở lượt', async () => {
    seedTask('S6', { current_phase: 'reviewer' })
    await handleEvent(
      ev('hitl.resolved', {
        taskId: 'S6',
        devTeamRoot: root,
        action: 'approve',
        currentPhase: 'reviewer',
        reason: 'pipeline_changed',
      }),
    )
    expect(turnsOf('S6')).toHaveLength(0)
  })
})

describe('trần số lượt — không tự kích vòng lặp (TC-24, TC-35)', () => {
  // E7: hai job cùng `resume` một session là hỏng transcript, nên lượt mới phải
  // đợi lượt cũ xong.
  test('đang có lượt chạy dở ⇒ không mở lượt chồng', async () => {
    seedTask('U1', { current_phase: 'reviewer' })
    writeJob('u1-busy', { taskId: 'U1', orchestratorJob: true }, { status: 'running' })
    const id = finishedStepJob('u1', 'U1')
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'U1', devTeamRoot: root }))
    expect(turnsOf('U1')).toHaveLength(0)
  })

  // E6 — agent trả `start` trỏ lại chính step vừa xong là một vòng vô hạn tốn
  // LLM. Trần đếm theo (task, phase); vượt trần thì dừng hẳn kèm lý do.
  test('quá trần lượt ở cùng một phase ⇒ halt kèm lý do đọc được', async () => {
    seedTask('U2', { current_phase: 'reviewer' })
    for (let i = 1; i <= 8; i++) {
      const id = finishedStepJob(`u2-${i}`, 'U2')
      await handleEvent(ev('job.finished', { jobId: id, taskId: 'U2', devTeamRoot: root }))
    }
    expect(haltReasons().some((r) => r.startsWith('orchestrator turn loop'))).toBe(true)
    // Trần là hữu hạn và nhỏ — 🚫 không phải "mỗi event một lượt".
    expect(turnsOf('U2').length).toBeLessThanOrEqual(6)
  })
})

describe('lượt agent hỏng ⇒ pipeline KHÔNG kẹt (TC-35)', () => {
  // Bước kế tất định (step vừa xong / vừa duyệt cổng / người vừa bấm Run) thì
  // output hỏng không được làm pipeline đứng — rơi về thứ tự pipeline.
  for (const trigger of ['step_finished', 'manual_start', 'gate_approved']) {
    test(`JSON hỏng ở trigger ${trigger} ⇒ chuyển tiếp tất định, không halt`, async () => {
      const taskId = `V-${trigger}`
      seedTask(taskId, { current_phase: 'reviewer' })
      const id = writeJob(
        `v-${trigger}`,
        { taskId, orchestratorJob: true, orchestratorTrigger: trigger },
        { status: 'succeeded', stdout: `${DECISION_SENTINEL} {khong-phai-json` },
      )
      await handleEvent(ev('job.finished', { jobId: id, taskId, devTeamRoot: root }))

      const fallback = dispatched().filter((e) => String(e.payload.reason ?? '').startsWith('agent_fallback'))
      expect(fallback).toHaveLength(1)
      expect(fallback[0].payload.stepId).toBe('reviewer')
      expect(haltReasons()).toHaveLength(0)
    })
  }

  // Với gate_rejected / job_failed thì KHÔNG có bước kế nào đúng — đoán bừa là
  // chạy sai mà không ai thấy, nên ở đó phải halt tường minh.
  test('JSON hỏng ở trigger gate_rejected ⇒ halt, không đoán bước kế', async () => {
    seedTask('V2', { current_phase: 'reviewer' })
    const id = writeJob(
      'v2',
      { taskId: 'V2', orchestratorJob: true, orchestratorTrigger: 'gate_rejected' },
      { status: 'succeeded', stdout: `${DECISION_SENTINEL} {khong-phai-json` },
    )
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'V2', devTeamRoot: root }))
    expect(haltReasons().some((r) => r.includes('invalid decision'))).toBe(true)
    expect(dispatched().filter((e) => e.payload.action === 'start')).toHaveLength(0)
  })

  test('cổng đang chờ người ⇒ lưới tất định KHÔNG vượt cổng', async () => {
    seedTask('V3', { current_phase: 'reviewer', hitl_pending: 'hitl-review' })
    const id = writeJob(
      'v3',
      { taskId: 'V3', orchestratorJob: true, orchestratorTrigger: 'step_finished' },
      { status: 'succeeded', stdout: `${DECISION_SENTINEL} {khong-phai-json` },
    )
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'V3', devTeamRoot: root }))
    expect(dispatched()).toHaveLength(0)
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * T8eb14482 — cấu hình `orchestrator.system_prompt`/`knowledge_inputs`.
 *
 * `writePipeline()` của file này chỉ nhận `enabled` + agent cố định, nên các
 * case dưới đây ghi `pipeline.yaml` riêng thay vì mở rộng hàm chung.
 * ──────────────────────────────────────────────────────────────────────────── */

function writePipelineWithOrchConfig(extra: string) {
  fs.writeFileSync(
    path.join(root, 'pipeline.yaml'),
    [
      'version: 1',
      `orchestrator: { enabled: true, agent: "a:orch", ${extra} }`,
      'steps:',
      '  - { id: implementer, name: Implement, agent: "a:impl" }',
      '  - { id: reviewer, name: Review, agent: "a:rev", hitl: { mode: manual, gate_id: hitl-review } }',
    ].join('\n'),
    'utf8',
  )
}

describe('cấu hình orchestrator (system_prompt/knowledge_inputs) — T8eb14482', () => {
  test('TC-CFG-01: system_prompt trong pipeline.yaml ⇒ userPrompt của lượt mới chứa đúng nội dung', async () => {
    writePipelineWithOrchConfig(
      'system_prompt: "Review có PO thì tự quay lại implementer để xử lý tiếp, không dừng chờ người."',
    )
    seedTask('CFG1', { current_phase: 'reviewer' })
    await handleEvent(ev('orchestrator.start_requested', { taskId: 'CFG1', devTeamRoot: root }))

    const turns = turnsOf('CFG1')
    expect(turns).toHaveLength(1)
    expect(turns[0].userPrompt).toContain(
      'Review có PO thì tự quay lại implementer để xử lý tiếp, không dừng chờ người.',
    )
  })

  test('TC-CFG-02: pipeline.yaml không khai 2 field mới ⇒ prompt không có phần hướng dẫn/knowledge bổ sung', async () => {
    writePipeline(true) // pipeline chuẩn của suite — không có system_prompt/knowledge_inputs
    seedTask('CFG2', { current_phase: 'reviewer' })
    await handleEvent(ev('orchestrator.start_requested', { taskId: 'CFG2', devTeamRoot: root }))

    const turns = turnsOf('CFG2')
    expect(turns).toHaveLength(1)
    expect(turns[0].userPrompt).not.toContain('Hướng dẫn bổ sung')
    expect(turns[0].userPrompt).not.toContain('## Knowledge')
  })

  test('TC-CFG-03: knowledge_inputs trộn id hợp lệ + không tồn tại ⇒ không crash, cả hai phần đều thấy được', async () => {
    await createFileDriver(root).write({
      slug: 'huong-dan-po',
      scope: 'project',
      content: 'Nội dung knowledge hợp lệ về xử lý PO.',
    })
    writePipelineWithOrchConfig('knowledge_inputs: ["project/huong-dan-po", "project/khong-ton-tai"]')
    seedTask('CFG3', { current_phase: 'reviewer' })
    await handleEvent(ev('orchestrator.start_requested', { taskId: 'CFG3', devTeamRoot: root }))

    const turns = turnsOf('CFG3')
    expect(turns).toHaveLength(1)
    expect(turns[0].userPrompt).toContain('Nội dung knowledge hợp lệ về xử lý PO.')
    expect(turns[0].userPrompt).toContain('not found')
  })
})

// TC-AUTO-01/02 — khi orchestrator có system_prompt hướng dẫn xử lý case lặp,
// một quyết định hợp lệ ở gate_rejected/job_failed phải dispatch bình thường,
// KHÔNG bị coi là bất thường hay bị chặn bởi việc mới thêm config. Đây là cơ
// chế MÀ auto-navigate dựa vào (agent đọc guidance rồi trả quyết định) —
// output thật của LLM không tất định nên không mô phỏng được trong unit test;
// phần "agent có tuân theo guidance hay không" ghi ở test-result.md mục kiểm
// chứng thủ công.
describe('TC-AUTO-01/02 — quyết định hợp lệ ở gate_rejected/job_failed vẫn dispatch bình thường khi có guidance', () => {
  test('TC-AUTO-01: review có PO (gate_rejected) + system_prompt cấu hình ⇒ quyết định resume implementer được dispatch, không halt', async () => {
    writePipelineWithOrchConfig('system_prompt: "Review có PO thì quay lại implementer."')
    seedTask('AUTO1')
    const id = writeJob(
      'auto1',
      { taskId: 'AUTO1', orchestratorJob: true, orchestratorTrigger: 'gate_rejected' },
      {
        status: 'succeeded',
        stdout: `${DECISION_SENTINEL} {"action":"start","stepId":"implementer","reason":"review có PO, quay lại xử lý"}`,
      },
    )
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'AUTO1', devTeamRoot: root }))
    expect(haltReasons()).toHaveLength(0)
    expect(dispatched().filter((e) => e.payload.stepId === 'implementer')).toHaveLength(1)
  })

  test('TC-AUTO-02: test phát hiện bug (job_failed) + system_prompt cấu hình ⇒ quyết định resume implementer được dispatch, không halt', async () => {
    writePipelineWithOrchConfig('system_prompt: "Test phát hiện bug thì quay lại implementer để sửa."')
    seedTask('AUTO2')
    const id = writeJob(
      'auto2',
      { taskId: 'AUTO2', orchestratorJob: true, orchestratorTrigger: 'job_failed' },
      {
        status: 'succeeded',
        stdout: `${DECISION_SENTINEL} {"action":"start","stepId":"implementer","reason":"test phát hiện bug, quay lại sửa"}`,
      },
    )
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'AUTO2', devTeamRoot: root }))
    expect(haltReasons()).toHaveLength(0)
    expect(dispatched().filter((e) => e.payload.stepId === 'implementer')).toHaveLength(1)
  })

  // Edge case của TC-AUTO-01/02: không cấu hình system_prompt ⇒ giữ hành vi cũ
  // (không phải hồi quy) — đã phủ bởi describe TC-SAFE ngay dưới đây và bởi
  // "lượt agent hỏng ⇒ pipeline KHÔNG kẹt (TC-35)" phía trên (không có config
  // orchestrator mới nào trong các case đó).
})

// TC-SAFE-01/02 — bất biến an toàn: dù orchestrator ĐÃ có system_prompt/
// knowledge_inputs cấu hình cho đúng case gate_rejected/job_failed, output
// hỏng/rỗng của agent quyết định vẫn phải halt — cấu hình mới không được che
// mất guard này (giữ nguyên `FALLBACK_TRIGGERS`/`recoverFromBadTurn`, D1).
describe('TC-SAFE-01/02 — guard halt KHÔNG bị cấu hình orchestrator mới che mất', () => {
  test('TC-SAFE-01: gate_rejected, có system_prompt, JSON hỏng ⇒ vẫn halt', async () => {
    writePipelineWithOrchConfig('system_prompt: "Review có PO thì quay lại implementer."')
    seedTask('SAFE1', { current_phase: 'reviewer' })
    const id = writeJob(
      'safe1',
      { taskId: 'SAFE1', orchestratorJob: true, orchestratorTrigger: 'gate_rejected' },
      { status: 'succeeded', stdout: `${DECISION_SENTINEL} {khong-phai-json` },
    )
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'SAFE1', devTeamRoot: root }))
    expect(haltReasons().some((r) => r.includes('invalid decision'))).toBe(true)
    expect(dispatched().filter((e) => e.payload.action === 'start')).toHaveLength(0)
  })

  test('TC-SAFE-02: job_failed, có system_prompt, output rỗng ⇒ vẫn halt', async () => {
    writePipelineWithOrchConfig('system_prompt: "Test phát hiện bug thì quay lại implementer."')
    seedTask('SAFE2')
    const id = writeJob(
      'safe2',
      { taskId: 'SAFE2', orchestratorJob: true, orchestratorTrigger: 'job_failed' },
      { status: 'succeeded' },
    )
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'SAFE2', devTeamRoot: root }))
    expect(haltReasons()).toContain('decision output unavailable')
    expect(dispatched()).toHaveLength(0)
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * T6427b18c — nhóm D: giao thức `STEP_SUMMARY` (con → cha).
 *
 * `stepResultOf` là hợp đồng giữa hai node: nút con viết một dòng cuối, nút cha
 * đọc đúng dòng đó. Chấm thuần trên (job record) → (StepResult), không cần bus.
 * ──────────────────────────────────────────────────────────────────────────── */

function jobWith(stdout: string | undefined, extra: Record<string, unknown> = {}): any {
  return { id: 'j', status: 'succeeded', ...(stdout === undefined ? {} : { stdout }), ...extra }
}

describe('T6427b18c nhóm D — stepResultOf đọc STEP_SUMMARY', () => {
  test('TC-36: lấy dòng STEP_SUMMARY làm kết quả, bỏ log làm việc', () => {
    const stdout = [
      'Đang đọc file…',
      'Chỉnh sửa 3 file…',
      'STEP_SUMMARY: Đã sửa sessionLedger, ghi design.md, còn chờ review.',
    ].join('\n')
    expect(stepResultOf(jobWith(stdout), 'designer', 'succeeded')).toEqual({
      stepId: 'designer',
      status: 'succeeded',
      artifacts: [],
      result: 'Đã sửa sessionLedger, ghi design.md, còn chờ review.',
      fromTail: false,
    })
  })

  test('TC-37: nhiều dòng STEP_SUMMARY ⇒ lấy dòng CUỐI có nội dung', () => {
    const a = stepResultOf(
      jobWith(['STEP_SUMMARY: bản nháp', 'nghĩ lại…', 'STEP_SUMMARY:', 'STEP_SUMMARY: bản chốt'].join('\n')),
      'designer',
      'succeeded',
    )
    expect(a).toMatchObject({ result: 'bản chốt', fromTail: false })

    // Dòng cuối rỗng ⇒ bỏ qua, lùi lên dòng trước, KHÔNG rơi về fromTail.
    const b = stepResultOf(
      jobWith(['STEP_SUMMARY: bản nháp', 'STEP_SUMMARY:'].join('\n')),
      'designer',
      'succeeded',
    )
    expect(b).toMatchObject({ result: 'bản nháp', fromTail: false })
  })

  test('TC-38: dòng bọc backtick / có khoảng trắng thừa vẫn nhận', () => {
    expect(stepResultOf(jobWith('log\n  `STEP_SUMMARY: nội dung`  '), 's', 'succeeded')).toMatchObject({
      result: 'nội dung',
      fromTail: false,
    })
    expect(stepResultOf(jobWith('log\n```STEP_SUMMARY: nội dung```'), 's', 'succeeded')).toMatchObject({
      result: 'nội dung',
      fromTail: false,
    })
  })

  test('TC-39: không có STEP_SUMMARY ⇒ fallback đuôi output', () => {
    const stdout = `${'log dài '.repeat(500)}\nkết luận ở cuối`
    const r = stepResultOf(jobWith(stdout), 'implementer', 'succeeded')
    expect(r.fromTail).toBe(true)
    // Cắt theo ngân sách là việc của `renderStepResult` (TC-28), không phải ở đây.
    expect(r.result).toBe(stdout)
  })

  test('TC-40: STEP_SUMMARY nằm GIỮA một dòng khác KHÔNG được nhận', () => {
    const line = 'Agent được dặn phải in STEP_SUMMARY: ở cuối'
    const r = stepResultOf(jobWith(line), 'implementer', 'succeeded')
    expect(r.fromTail).toBe(true)
    expect(r.result).toBe(line)
  })

  test('TC-42: artifacts lấy từ job, mảng rỗng khi job không ghi gì', () => {
    expect(stepResultOf(jobWith('x', { artifactsFound: ['design.md', 'qa.md'] }), 's', 'succeeded').artifacts).toEqual([
      'design.md',
      'qa.md',
    ])
    expect(stepResultOf(jobWith('x'), 's', 'succeeded').artifacts).toEqual([])
    expect(stepResultOf(null, 's', 'failed').artifacts).toEqual([])
  })
})

/*
 * §6.1 + §6.4 của test-spec — bổ sung sau review.
 *
 * `job.stdout` của provider `sessionCapture: 'parse-json'` ĐÃ được provider bóc
 * khỏi khung JSON (`providers/claude-code-cli.ts`, `if (parsed.result != null)
 * stdout = parsed.result`), nên giá trị persist ở `jobQueue` luôn là text thuần.
 * Bóc lần thứ hai ở `stepResultOf` không giúp gì và có thể nuốt mất chính dòng
 * `STEP_SUMMARY` mà task này sinh ra.
 */
describe('T6427b18c nhóm D — job.stdout là TEXT THUẦN, không bóc lần hai', () => {
  test("TC-41': stdout text thuần của provider parse-json đọc đúng STEP_SUMMARY", () => {
    expect(stepResultOf(jobWith('đã sửa 3 file\nSTEP_SUMMARY: xong rồi'), 's', 'succeeded')).toMatchObject({
      result: 'xong rồi',
      fromTail: false,
    })
  })

  test('TC-41″: văn bản có chứa object JSON mang khoá `result` KHÔNG được bóc', () => {
    const stdout = 'Here is the config:\n{"result": "something else"}\nSTEP_SUMMARY: thật sự xong'
    const r = stepResultOf(jobWith(stdout), 's', 'succeeded')
    expect(r.result).toBe('thật sự xong')
    expect(r.fromTail).toBe(false)
    expect(r.result).not.toContain('something else')
  })

  test('TC-41‴: văn bản nhiều khối ngoặc không làm hỏng việc đọc STEP_SUMMARY', () => {
    expect(stepResultOf(jobWith('tôi sửa {a:1} và {b:2}\nSTEP_SUMMARY: ok'), 's', 'succeeded')).toMatchObject({
      result: 'ok',
      fromTail: false,
    })
  })

  test('TC-D-X2: STEP_SUMMARY kết câu bằng code span không bị ăn backtick', () => {
    const r = stepResultOf(jobWith('log\nSTEP_SUMMARY: đã ghi `design.md`'), 's', 'succeeded')
    expect(r.result).toBe('đã ghi `design.md`')
  })

  /*
   * TC-D-X1 — hai ca "nút con không in STEP_SUMMARY" và "không đọc được
   * stdout" hiện KHÔNG phân biệt được từ phía nút cha: `shouldPersistStdout`
   * chỉ persist stdout cho provider agent-CLI, nên connection `*-api` /
   * `console-command` không có `job.stdout` và cả hai ca đều ra `fromTail: true`.
   *
   * Cách phân biệt (`source: 'unavailable'`, hoặc đọc `STEP_SUMMARY` ngay trong
   * `runJob` rồi ghi vào `job.metadata.stepSummary`) CHƯA được chốt ở
   * `design.md` §4.4, nên ở đây chỉ khoá hành vi HIỆN TẠI — để lần chốt sau
   * phải sửa test một cách tường minh chứ không trôi im lặng.
   */
  test('TC-D-X1 (characterization): stdout vắng mặt và stdout không có tóm tắt hiện ra cùng một hình dạng', () => {
    const noStdout = stepResultOf(jobWith(undefined), 's', 'succeeded')
    const noSummary = stepResultOf(jobWith('log dài\nkhông có tóm tắt'), 's', 'succeeded')
    expect(noStdout).toMatchObject({ result: '', fromTail: true })
    expect(noSummary).toMatchObject({ fromTail: true })
    // Cùng một cờ cho hai nguyên nhân khác hẳn nhau — đây là điểm còn nợ.
    expect(noStdout.fromTail).toBe(noSummary.fromTail)
  })
})

/*
 * TC-43 / §4.2-C — lượt điều phối LUÔN submit với `sessionMode: 'resume'`.
 * Quyết định new/resume do LEDGER đưa ra (entry khoá theo `stepId`), không do
 * guard `hasOwnSession` ở orchestrator như trước.
 */
describe('T6427b18c — job điều phối luôn submit sessionMode resume (TC-43)', () => {
  test('lượt điều phối mang sessionMode resume + stepId của chính nó, không bị guard chặn', async () => {
    seedTask('SM1', { current_phase: 'reviewer' })
    const id = finishedStepJob('sm1', 'SM1')
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'SM1', devTeamRoot: root }))

    const turns = turnsOf('SM1')
    expect(turns).toHaveLength(1)
    // `resume` kể cả ở lượt ĐẦU: guard `hasOwnSession` cũ đã bị bỏ, việc chọn
    // new/resume là của `resolveSessionPlan` dựa trên `stepId` (TC-03/TC-04).
    expect(turns[0].metadata.inputSessionMode).toBe('resume')
    expect(turns[0].metadata.stepId).toBe('__orchestrator__')
  })

  test('lượt thứ hai của cùng task vẫn resume — không lượt nào ép new', async () => {
    seedTask('SM2', { current_phase: 'reviewer' })
    await handleEvent(ev('job.finished', { jobId: finishedStepJob('sm2a', 'SM2'), taskId: 'SM2', devTeamRoot: root }))
    await handleEvent(ev('job.finished', { jobId: finishedStepJob('sm2b', 'SM2'), taskId: 'SM2', devTeamRoot: root }))

    const turns = turnsOf('SM2')
    expect(turns.length).toBeGreaterThanOrEqual(2)
    expect(turns.every((t) => t.metadata.inputSessionMode === 'resume')).toBe(true)
    expect(turns.every((t) => t.metadata.stepId === '__orchestrator__')).toBe(true)
  })
})

/*
 * TC-R6 — tập field của domain event không đổi. Task này chỉ đổi NỘI DUNG
 * prompt và cách ly ledger; event là hợp đồng với UI/automation nên phải đứng yên.
 */
describe('T6427b18c — domain event giữ nguyên payload (TC-R6)', () => {
  test('orchestrator.dispatched giữ đúng tập field (taskId, projectId, devTeamRoot, action, reason)', async () => {
    seedTask('EV1', { current_phase: 'reviewer', hitl_pending: 'hitl-review' })
    const id = writeJob(
      'ev1',
      { taskId: 'EV1', orchestratorJob: true, orchestratorTrigger: 'step_finished' },
      { status: 'succeeded', stdout: `${DECISION_SENTINEL} {"action":"summary","summary":"xong","reason":"chờ người"}` },
    )
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'EV1', devTeamRoot: root }))

    const d = dispatched()
    expect(d).toHaveLength(1)
    expect(Object.keys(d[0].payload).sort()).toEqual(['action', 'devTeamRoot', 'projectId', 'reason', 'taskId'])
    expect(d[0].payload).toMatchObject({ taskId: 'EV1', devTeamRoot: root, action: 'summary', reason: 'chờ người' })
  })

  test('orchestrator.halted giữ đúng tập field', async () => {
    seedTask('EV2', { current_phase: 'reviewer' })
    const id = writeJob(
      'ev2',
      { taskId: 'EV2', orchestratorJob: true, orchestratorTrigger: 'step_finished' },
      { status: 'succeeded', stdout: `${DECISION_SENTINEL} {"action":"halt","reason":"bó tay"}` },
    )
    await handleEvent(ev('job.finished', { jobId: id, taskId: 'EV2', devTeamRoot: root }))

    const h = seen.filter((e) => e.type === 'orchestrator.halted')
    expect(h).toHaveLength(1)
    expect(Object.keys(h[0].payload).sort()).toEqual(['devTeamRoot', 'projectId', 'reason', 'taskId'])
  })
})
