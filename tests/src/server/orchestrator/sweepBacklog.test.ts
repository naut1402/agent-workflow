import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import type { DashboardEvent } from '../../../../src/backend/events/index.js'
import {
  _resetOrchestratorForTest,
  chatWithOrchestrator,
  sweepStuckTasks,
} from '../../../../src/features/orchestrator/business/decisionLoop.js'
import { DECISION_SENTINEL } from '../../../../src/features/orchestrator/schemas/orchestrator.js'
import { cancelJob, type JobRecord } from '../../../../src/features/runner/business/index.js'
import * as H from './parallelHarness.js'

/*
 * Ted0cf9ac — nhóm C: lưới an toàn sweep (D2) + tin nhắn chờ sau restart (TC-25)
 * + `cancelJob` chỉ phát `job.cancelled` (review.md §3 điểm 3).
 *
 * "Restart" = `_resetOrchestratorForTest()` (mất mọi state in-memory: lượt hoãn,
 * khoá lượt, bộ đếm) trong khi `.dev-state` và job record trên đĩa còn nguyên.
 * Lịch sử job trước restart được ghi thẳng làm record — tất định hơn chạy thật.
 *
 * Đã chốt ở review (MỚI-2): sweep bỏ qua step xong chưa tới 60s, nên các ca lưới
 * an toàn đặt `finishedAt` cũ hơn 60s; có ca riêng cho step vừa xong < 60s.
 */

let h: H.Harness
const seen: DashboardEvent[] = []
const START_IMPLEMENTER = `${DECISION_SENTINEL} {"action":"start","stepId":"implementer","reason":"bước kế"}`

function ago(sec: number): string {
  return new Date(Date.now() - sec * 1000).toISOString()
}

/** Job record có sẵn trên đĩa (lịch sử trước restart). */
function writeJob(id: string, metadata: Record<string, unknown>, extra: Partial<JobRecord> & Record<string, unknown>) {
  const dir = path.join(h.home, 'jobs')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify({
      id,
      status: 'succeeded',
      runnerId: 'r',
      agentRef: '',
      workspace: path.join(h.root, 'tasks', String(metadata.taskId)),
      createdAt: ago(300),
      startedAt: ago(300),
      finishedAt: null,
      metadata: { devTeamRoot: h.root, projectId: H.PROJECT, ...metadata },
      ...extra,
    }),
    'utf8',
  )
  return id
}

/** S1 do nút điều phối dispatch, đã xong `secAgo` giây trước. */
function finishedStep(id: string, taskId: string, secAgo: number, meta: Record<string, unknown> = {}) {
  return writeJob(
    id,
    { taskId, pipelineStepId: 'investigator', orchestratorDispatch: true, stepSummary: 'điều tra xong', ...meta },
    { status: 'succeeded', createdAt: ago(secAgo + 60), startedAt: ago(secAgo + 60), finishedAt: ago(secAgo) },
  )
}

function newTurns(taskId: string): JobRecord[] {
  return H.turnsOf(taskId).filter((j) => j.userPrompt && !j.id.startsWith('rec-'))
}

function dispatchedFor(taskId: string) {
  return seen.filter((e) => e.type === 'orchestrator.dispatched' && (e.payload as any)?.taskId === taskId)
}

async function sweep() {
  await sweepStuckTasks(h.root, H.PROJECT)
  await H.flush()
}

function pendingChat(taskId: string): string[] {
  return H.stateOf(h.root, taskId).pending_orchestrator_chat?.messages ?? []
}

function writeState(taskId: string, patch: Record<string, unknown>) {
  const file = path.join(h.root, '.dev-state', `${taskId}.json`)
  fs.writeFileSync(file, JSON.stringify({ ...H.stateOf(h.root, taskId), ...patch }, null, 2), 'utf8')
}

beforeAll(() => {
  h = H.setupHarness('sweep')
})
afterAll(() => H.teardownHarness(h))
beforeEach(() => {
  H.resetLoop(seen)
  H.writePipeline(h.root)
})
afterEach(async () => {
  h.releaseAll()
  await H.flush()
})

describe('TC-18 — restart khi đang có lượt hoãn ⇒ sweep đưa task đi tiếp', () => {
  test('S1 xong > 60s, lượt hoãn mất, O1 đã bị reap ⇒ 1 chu kỳ sweep mở lượt step_finished; lượt đó start bước kế', async () => {
    const T = 'C18'
    H.seedTask(h.root, T, { current_phase: 'implementer' })
    writeJob('rec-c18-o1', { taskId: T, orchestratorJob: true, orchestratorTrigger: 'chat' }, {
      status: 'failed',
      createdAt: ago(200),
      finishedAt: ago(10),
    })
    finishedStep('rec-c18-s1', T, 120)
    _resetOrchestratorForTest() // restart: lượt hoãn in-memory mất

    await sweep()
    const turns = newTurns(T)
    expect(turns).toHaveLength(1)
    expect(turns[0].metadata?.orchestratorTrigger).toBe('step_finished')
    expect(turns[0].userPrompt).toContain('điều tra xong')

    await H.waitRunning(h, turns[0].id)
    h.finish(turns[0].id, { stdout: START_IMPLEMENTER })
    await H.waitFor(
      () => H.jobsOf(T).find((j) => j.metadata?.pipelineStepId === 'implementer' && j.metadata?.orchestratorJob !== true),
      'implementer được dispatch',
    )
  })

  test('MỚI-2: step vừa xong < 60s, chưa có lượt nào ⇒ sweep KHÔNG mở lượt (đợi chu kỳ sau)', async () => {
    const T = 'C18-fresh'
    H.seedTask(h.root, T, { current_phase: 'implementer' })
    finishedStep('rec-c18f-s1', T, 5)
    await sweep()
    expect(newTurns(T)).toHaveLength(0)
    expect(dispatchedFor(T)).toHaveLength(0)
  })

  test('step chạy tay (không do điều phối dispatch) xong > 60s ⇒ sweep không tự mở lượt', async () => {
    const T = 'C18-manual'
    H.seedTask(h.root, T, { current_phase: 'implementer' })
    finishedStep('rec-c18m-s1', T, 120, { orchestratorDispatch: undefined })
    await sweep()
    expect(newTurns(T)).toHaveLength(0)
  })
})

describe('TC-19 — sweep không tạo lượt trùng khi lượt hoãn đã chạy bình thường', () => {
  test('đã có lượt sau khi S1 xong ⇒ nhiều chu kỳ sweep không mở thêm lượt, không start lại bước kế', async () => {
    const T = 'C19'
    H.seedTask(h.root, T, { current_phase: 'implementer' })
    finishedStep('rec-c19-s1', T, 180)
    writeJob('rec-c19-o2', { taskId: T, orchestratorJob: true, orchestratorTrigger: 'step_finished' }, {
      status: 'succeeded',
      createdAt: ago(170),
      finishedAt: ago(160),
    })
    for (let i = 0; i < 3; i++) await sweep()
    expect(newTurns(T)).toHaveLength(0)
    expect(H.jobsOf(T).filter((j) => j.metadata?.pipelineStepId === 'implementer')).toHaveLength(0)
  })
})

describe('TC-20 — sweep không chen vào khi nút điều phối đang bận', () => {
  test('lượt hoãn đang chờ O1 ⇒ sweep không tạo lượt song song; sau O1 tổng lượt step_finished vẫn là 1', async () => {
    const T = 'C20'
    H.seedTask(h.root, T)
    const s1 = H.submitStep(h.root, T, 'investigator')
    await H.waitRunning(h, s1.id)
    const res = await chatWithOrchestrator(h.root, H.PROJECT, T, 'hỏi')
    const o1 = (res as { job: JobRecord }).job.id
    await H.waitRunning(h, o1)
    h.finish(s1.id)
    await H.waitSettled(s1.id)
    await H.flush()

    await sweep()
    await sweep()
    expect(H.liveTurns(T)).toHaveLength(1)
    expect(H.turnsOf(T)).toHaveLength(1)

    h.finish(o1)
    const replay = await H.waitFor(() => H.turnsOf(T).find((j) => j.id !== o1), 'lượt chạy lại')
    await H.waitRunning(h, replay.id)
    await sweep()
    h.finish(replay.id)
    await H.waitSettled(replay.id)
    await sweep()
    expect(H.turnsOf(T).filter((j) => j.metadata?.orchestratorTrigger === 'step_finished')).toHaveLength(1)
  })
})

describe('TC-25 — tin nhắn chờ không mất khi restart; gửi ở sweep đầu tiên không còn job điều phối sống', () => {
  test('O1 còn sống (chưa reap) ⇒ sweep giữ nguyên M1, M2; O1 bị reap ⇒ sweep gửi 1 lượt chat M1 → M2', async () => {
    const T = 'C25'
    H.seedTask(h.root, T, {
      current_phase: 'implementer',
      pending_orchestrator_chat: { messages: ['M1-one', 'M2-two'], queuedAt: ago(30) },
    })
    writeJob('rec-c25-o1', { taskId: T, orchestratorJob: true, orchestratorTrigger: 'chat' }, {
      status: 'running',
      createdAt: ago(60),
    })
    _resetOrchestratorForTest()

    await sweep()
    expect(newTurns(T)).toHaveLength(0)
    expect(pendingChat(T)).toEqual(['M1-one', 'M2-two'])

    // Job mồ côi bị reap sau restart.
    writeJob('rec-c25-o1', { taskId: T, orchestratorJob: true, orchestratorTrigger: 'chat' }, {
      status: 'failed',
      createdAt: ago(60),
      finishedAt: ago(1),
    })
    await sweep()
    const turns = newTurns(T)
    expect(turns).toHaveLength(1)
    expect(turns[0].metadata?.orchestratorTrigger).toBe('chat')
    const p = String(turns[0].userPrompt)
    expect(p.indexOf('M1-one')).toBeGreaterThanOrEqual(0)
    expect(p.indexOf('M2-two')).toBeGreaterThan(p.indexOf('M1-one'))
    expect(pendingChat(T)).toEqual([])
  })

  test('tin nhắn chờ được gửi cả khi task đang chờ gate (MỚI-1 đứng trước hitl_pending)', async () => {
    const T = 'C25-gate'
    H.writePipeline(h.root, { gateOnReviewer: true })
    H.seedTask(h.root, T, {
      current_phase: 'reviewer',
      hitl_pending: 'hitl-review',
      pending_orchestrator_chat: { messages: ['M-gate'], queuedAt: ago(30) },
    })
    _resetOrchestratorForTest()
    await sweep()
    const turns = newTurns(T)
    expect(turns).toHaveLength(1)
    expect(turns[0].userPrompt).toContain('M-gate')
  })
})

describe('cancelJob chỉ phát job.cancelled (review §3 điểm 3) ⇒ sweep nhặt lại trong 1 chu kỳ', () => {
  test('huỷ O1 khi có lượt hoãn + tin nhắn chờ ⇒ không chạy ngay; 1 chu kỳ sweep chạy lượt hoãn, rồi lượt chat', async () => {
    const T = 'C-cancel'
    H.seedTask(h.root, T)
    const s1 = H.submitStep(h.root, T, 'investigator')
    await H.waitRunning(h, s1.id)
    const o1 = ((await chatWithOrchestrator(h.root, H.PROJECT, T, 'hỏi')) as { job: JobRecord }).job.id
    await H.waitRunning(h, o1)
    h.finish(s1.id)
    await H.waitSettled(s1.id)
    await H.flush()
    expect(await chatWithOrchestrator(h.root, H.PROJECT, T, 'M-cancel')).toEqual({ queued: true })

    expect(cancelJob(o1).ok).toBe(true)
    await H.flush(40)
    expect(H.turnsOf(T)).toHaveLength(1)

    await sweep()
    const replay = await H.waitFor(() => H.turnsOf(T).find((j) => j.id !== o1), 'lượt hoãn sau sweep')
    expect(replay.metadata?.orchestratorTrigger).toBe('step_finished')
    expect(pendingChat(T)).toEqual(['M-cancel'])

    await H.waitRunning(h, replay.id)
    h.finish(replay.id)
    const chat = await H.waitFor(
      () => H.turnsOf(T).find((j) => j.id !== o1 && j.id !== replay.id),
      'lượt chat sau lượt hoãn',
    )
    expect(chat.userPrompt).toContain('M-cancel')
  })
})

describe('TC-21a — hành vi sweep cũ không đổi khi không có việc treo', () => {
  test('task treo thật (chưa có job nào) ⇒ vẫn nối lại đúng bước hiện tại', async () => {
    const T = 'C21a'
    H.seedTask(h.root, T, { current_phase: 'implementer' })
    await sweep()
    expect(dispatchedFor(T)).toHaveLength(1)
    expect(dispatchedFor(T)[0].payload).toMatchObject({ stepId: 'implementer', reason: 'sweep_resume' })
    expect(newTurns(T)).toHaveLength(0)
  })

  test('task chờ gate, không có tin nhắn chờ ⇒ không đụng tới', async () => {
    const T = 'C21a-gate'
    H.writePipeline(h.root, { gateOnReviewer: true })
    H.seedTask(h.root, T, { current_phase: 'reviewer', hitl_pending: 'hitl-review' })
    writeState(T, {})
    await sweep()
    expect(dispatchedFor(T)).toHaveLength(0)
    expect(newTurns(T)).toHaveLength(0)
  })
})
