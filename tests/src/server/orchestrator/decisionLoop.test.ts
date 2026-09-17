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
import { listJobs } from '../../../../src/features/runner/business/index.js'

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

  // TC-11 — tool `orchestrator_decide` đánh dấu `mcpDecisionApplied` trên job
  // TRƯỚC khi thi hành quyết định (xem `mcpTools.test.ts`). Khi job đó sau này
  // `job.finished`, sentinel cuối output của CÙNG lượt không được áp dụng lần
  // nữa — nếu không, một quyết định gọi qua tool sẽ bị dispatch hai lần (một
  // lần lúc gọi tool, một lần nữa khi đọc lại dòng JSON cuối output).
  test('TC-11: đã áp dụng qua tool (mcpDecisionApplied) ⇒ bỏ qua sentinel cùng lượt, không dispatch lần 2', async () => {
    seedTask('O6')
    const id = writeJob(
      'o6',
      { taskId: 'O6', orchestratorJob: true, orchestratorTrigger: 'step_finished', mcpDecisionApplied: true },
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
