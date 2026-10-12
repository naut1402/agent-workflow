import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import type { DashboardEvent } from '../../../../src/backend/events/index.js'
import { emit } from '../../../../src/backend/events/index.js'
import {
  chatWithOrchestrator,
  drainOrchestratorBacklog,
  handleEvent,
  startOrchestratorTurn,
} from '../../../../src/features/orchestrator/business/decisionLoop.js'
import { DECISION_SENTINEL } from '../../../../src/features/orchestrator/schemas/orchestrator.js'
import { sendTaskFeedback, type JobRecord } from '../../../../src/features/runner/business/index.js'
import * as H from './parallelHarness.js'

/*
 * Ted0cf9ac — nhóm B (D2: lượt hoãn), D (D3/D5: tin nhắn chờ), E (D6: thứ tự).
 *
 * Bề mặt chấm: job điều phối được tạo (trigger + prompt), trạng thái job, field
 * `pending_orchestrator_chat` trong `.dev-state`, và event `orchestrator.halted`.
 * Không đọc biến nội bộ (`deferredTurns`, `turnsAtPhase`).
 *
 * Kết quả đã chốt ở review.md §3 được khoá ở đây:
 *   - hai lượt hoãn cùng mức ưu tiên ⇒ lượt MỚI NHẤT thắng.
 */

let h: H.Harness
const seen: DashboardEvent[] = []

const START_IMPLEMENTER = `${DECISION_SENTINEL} {"action":"start","stepId":"implementer","reason":"bước kế"}`

function turnJobId(res: unknown): string {
  if (!res || typeof res !== 'object' || !('job' in res)) throw new Error(`không có job: ${JSON.stringify(res)}`)
  return (res as { job: { id: string } }).job.id
}

function triggersOf(taskId: string): string[] {
  return H.turnsOf(taskId).map((j) => String(j.metadata?.orchestratorTrigger))
}

function halted(taskId: string): boolean {
  return seen.some((e) => e.type === 'orchestrator.halted' && (e.payload as any)?.taskId === taskId)
}

function pendingChat(taskId: string): string[] {
  return H.stateOf(h.root, taskId).pending_orchestrator_chat?.messages ?? []
}

/** Lượt điều phối mới (khác các id đã biết) — chờ tới khi nó running. */
async function nextTurn(taskId: string, known: string[]): Promise<JobRecord> {
  const job = await H.waitFor(
    () => H.turnsOf(taskId).find((j) => !known.includes(j.id)),
    `lượt điều phối mới của ${taskId}`,
  )
  await H.waitRunning(h, job.id)
  return job
}

/** Không bao giờ có hai job điều phối của task cùng sống. */
function assertAtMostOneLiveTurn(taskId: string) {
  expect(H.liveTurns(taskId).length).toBeLessThanOrEqual(1)
}

/** S1 (bước `investigator`, không gate) đang chạy + O1 (lượt `chat`) đang chạy. */
async function busyWithChat(taskId: string, state: Record<string, unknown> = {}) {
  H.seedTask(h.root, taskId, state)
  const step = String(state.current_phase ?? 'investigator')
  const s1 = H.submitStep(h.root, taskId, step)
  await H.waitRunning(h, s1.id)
  const o1 = turnJobId(await chatWithOrchestrator(h.root, H.PROJECT, taskId, 'đang thế nào?'))
  await H.waitRunning(h, o1)
  return { s1: s1.id, o1 }
}

/** Chỉ O1 (lượt `chat`) đang chạy, không có step nào. */
async function busyOnly(taskId: string, state: Record<string, unknown> = {}) {
  H.seedTask(h.root, taskId, state)
  const o1 = turnJobId(await chatWithOrchestrator(h.root, H.PROJECT, taskId, 'đang thế nào?'))
  await H.waitRunning(h, o1)
  return o1
}

function gateResolved(taskId: string, action: 'approve' | 'reject', currentPhase = 'implementer') {
  emit('hitl.resolved', { taskId, devTeamRoot: h.root, projectId: H.PROJECT, action, currentPhase, gateId: 'g' })
}
function startRequested(taskId: string) {
  emit('orchestrator.start_requested', { taskId, devTeamRoot: h.root, projectId: H.PROJECT })
}

beforeAll(() => {
  h = H.setupHarness('backlog')
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

/* ── B. Lượt hoãn (D2) ─────────────────────────────────────────────────────── */

describe('TC-08/TC-09/TC-10 — step kết thúc khi nút điều phối bận ⇒ lượt chạy sau, task không đứng', () => {
  test('TC-08: step_finished hoãn, chạy NGAY sau O1 (không sweep), quyết định start bước kế', async () => {
    const T = 'B08'
    const { s1, o1 } = await busyWithChat(T)
    h.finish(s1, { stdout: 'STEP_SUMMARY: điều tra xong' })
    await H.waitSettled(s1)
    await H.flush()

    // Trong lúc O1 còn chạy: không có lượt thứ hai.
    expect(H.turnsOf(T).map((j) => j.id)).toEqual([o1])
    expect(H.stateOf(h.root, T).current_phase).toBe('implementer')

    h.finish(o1)
    const replay = await nextTurn(T, [o1])
    expect(replay.metadata?.orchestratorTrigger).toBe('step_finished')
    // Kết quả của S1 không bị mất: lượt chạy lại mang tóm tắt của nó.
    expect(replay.userPrompt).toContain('điều tra xong')
    await H.flush()
    expect(H.turnsOf(T)).toHaveLength(2)

    h.finish(replay.id, { stdout: START_IMPLEMENTER })
    const next = await H.waitFor(
      () => H.jobsOf(T).find((j) => j.metadata?.pipelineStepId === 'implementer' && j.metadata?.orchestratorJob !== true),
      'step implementer được dispatch',
    )
    expect(next.metadata?.orchestratorDispatch).toBe(true)
    expect(halted(T)).toBe(false)
  })

  test('TC-09: step fail khi O1 chạy ⇒ đúng 1 lượt job_failed sau O1', async () => {
    const T = 'B09'
    const { s1, o1 } = await busyWithChat(T)
    h.finish(s1, { ok: false })
    await H.waitSettled(s1)
    await H.flush()
    expect(H.turnsOf(T)).toHaveLength(1)

    h.finish(o1)
    const replay = await nextTurn(T, [o1])
    expect(replay.metadata?.orchestratorTrigger).toBe('job_failed')
    await H.flush()
    expect(triggersOf(T).filter((t) => t === 'job_failed')).toHaveLength(1)
  })

  // [Bug nguồn — xem test-result.md] O1 kết thúc bằng quyết định `summary` trên
  // pipeline đã completed ⇒ `applySummary` gọi `forgetTask`, xoá luôn slot lượt
  // hoãn TRƯỚC khi `drainOrchestratorBacklog` chạy ⇒ lượt pipeline_completed mất.
  test('TC-10: step cuối xong khi O1 chạy ⇒ đúng 1 lượt pipeline_completed sau O1', async () => {
    const T = 'B10'
    const { s1, o1 } = await busyWithChat(T, { current_phase: 'reviewer' })
    h.finish(s1)
    await H.waitSettled(s1)
    await H.flush()
    expect(H.stateOf(h.root, T).current_phase).toBe('completed')
    expect(H.turnsOf(T)).toHaveLength(1)

    h.finish(o1)
    const replay = await nextTurn(T, [o1])
    expect(replay.metadata?.orchestratorTrigger).toBe('pipeline_completed')
    await H.flush()
    expect(triggersOf(T).filter((t) => t === 'pipeline_completed')).toHaveLength(1)
  })
})

describe('TC-11/TC-12 — 1 slot/task, giữ lượt ưu tiên cao nhất', () => {
  test('TC-11: nhiều lượt bị từ chối (gate rồi manual_start) ⇒ sau O1 chỉ 1 lượt chạy lại, là gate', async () => {
    const T = 'B11'
    const o1 = await busyOnly(T, { current_phase: 'implementer' })
    gateResolved(T, 'approve')
    await H.flush()
    startRequested(T)
    await H.flush()
    expect(H.turnsOf(T)).toHaveLength(1)

    h.finish(o1)
    const replay = await nextTurn(T, [o1])
    expect(replay.metadata?.orchestratorTrigger).toBe('gate_approved')
    await H.flush(40)
    expect(H.turnsOf(T)).toHaveLength(2)
  })

  type Ev = 'gate' | 'step_finished' | 'job_failed' | 'pipeline_completed' | 'manual_start' | 'chat'

  /** Phát một lượt bị từ chối vì bận. Step event dùng job step thật kết thúc. */
  async function fire(T: string, e: Ev): Promise<void> {
    if (e === 'gate') gateResolved(T, 'approve', String(H.stateOf(h.root, T).current_phase))
    else if (e === 'manual_start') startRequested(T)
    else if (e === 'chat') {
      const res = await chatWithOrchestrator(h.root, H.PROJECT, T, 'tin nhắn chờ')
      expect(res).toEqual({ queued: true })
    } else {
      const phase = e === 'pipeline_completed' ? 'reviewer' : String(H.stateOf(h.root, T).current_phase)
      const s = H.submitStep(h.root, T, phase)
      await H.waitRunning(h, s.id)
      h.finish(s.id, { ok: e !== 'job_failed' })
      await H.waitSettled(s.id)
    }
    await H.flush()
  }

  const rows: Array<{ n: number; x: Ev | null; y: Ev; expected: string | null; phase?: string }> = [
    { n: 1, x: 'gate', y: 'step_finished', expected: 'step_finished' },
    { n: 2, x: 'step_finished', y: 'gate', expected: 'step_finished' },
    { n: 3, x: 'manual_start', y: 'gate', expected: 'gate_approved' },
    { n: 4, x: 'gate', y: 'manual_start', expected: 'gate_approved' },
    { n: 5, x: 'manual_start', y: 'job_failed', expected: 'job_failed' },
    // #6 đỏ cùng nguyên nhân với TC-10 (bug nguồn — xem test-result.md).
    { n: 6, x: 'pipeline_completed', y: 'manual_start', expected: 'pipeline_completed', phase: 'reviewer' },
    { n: 7, x: 'step_finished', y: 'chat', expected: 'step_finished' },
    { n: 8, x: null, y: 'chat', expected: null },
  ]

  for (const row of rows) {
    test(`TC-12 #${row.n}: ${row.x ?? '(không)'} rồi ${row.y} ⇒ lượt chạy lại ${row.expected ?? '(không có, chỉ chat)'}`, async () => {
      const T = `B12-${row.n}`
      const o1 = await busyOnly(T, { current_phase: row.phase ?? 'investigator' })
      if (row.x) await fire(T, row.x)
      await fire(T, row.y)
      expect(H.turnsOf(T)).toHaveLength(1)

      h.finish(o1)
      const replay = await nextTurn(T, [o1])
      await H.flush()
      const known = [o1, replay.id]
      if (row.expected) {
        expect(replay.metadata?.orchestratorTrigger).toBe(row.expected)
        expect(H.turnsOf(T)).toHaveLength(2)
      } else {
        // Không có lượt hoãn: chỉ lượt `chat` từ tin nhắn chờ.
        expect(replay.metadata?.orchestratorTrigger).toBe('chat')
      }
      if (row.y === 'chat' && row.expected) {
        // Chat không vào slot: nó thành tin nhắn chờ, chạy SAU lượt hoãn.
        h.finish(replay.id)
        const chat = await nextTurn(T, known)
        expect(chat.metadata?.orchestratorTrigger).toBe('chat')
        expect(chat.userPrompt).toContain('tin nhắn chờ')
      }
    })
  }

  test('TC-12 cùng mức (đã chốt review §3): job_failed rồi step_finished ⇒ lượt MỚI NHẤT (step_finished) thắng, đúng 1 lượt', async () => {
    const T = 'B12-same'
    const o1 = await busyOnly(T, { current_phase: 'investigator' })
    await fire(T, 'job_failed')
    await fire(T, 'step_finished')
    h.finish(o1)
    const replay = await nextTurn(T, [o1])
    await H.flush(40)
    expect(replay.metadata?.orchestratorTrigger).toBe('step_finished')
    expect(H.turnsOf(T)).toHaveLength(2)
    expect(halted(T)).toBe(false)
  })

  test('TC-12 cùng mức (đã chốt review §3): step_finished rồi job_failed ⇒ job_failed (mới nhất) thắng', async () => {
    const T = 'B12-same2'
    const o1 = await busyOnly(T, { current_phase: 'investigator' })
    await fire(T, 'step_finished')
    await fire(T, 'job_failed')
    h.finish(o1)
    const replay = await nextTurn(T, [o1])
    await H.flush(40)
    expect(replay.metadata?.orchestratorTrigger).toBe('job_failed')
    expect(H.turnsOf(T)).toHaveLength(2)
  })
})

describe('TC-13 — lượt bị hoãn không tăng bộ đếm lượt tại phase', () => {
  // Bộ đếm `turnsAtPhase` là in-memory; bề mặt quan sát được là mốc halt
  // "orchestrator turn loop" (MAX_TURNS_PER_PHASE = 6 lượt / phase).
  test('7 lần gate bị từ chối khi bận ⇒ không halt; sau đó đúng 6 lượt thật thì lượt thứ 7 mới halt', async () => {
    const T = 'B13'
    const o1 = await busyOnly(T, { current_phase: 'implementer' })
    for (let i = 0; i < 7; i++) {
      gateResolved(T, 'approve')
      await H.flush(5)
    }
    expect(halted(T)).toBe(false)
    expect(H.turnsOf(T)).toHaveLength(1)

    // Lượt hoãn chạy lại — lượt thật thứ 1 ở phase implementer.
    h.finish(o1)
    let last = await nextTurn(T, [o1])
    expect(last.metadata?.orchestratorTrigger).toBe('gate_approved')
    const known = [o1, last.id]
    // Lượt thật thứ 2…6: mỗi lượt chạy khi rảnh.
    for (let i = 2; i <= 6; i++) {
      h.finish(last.id)
      await H.waitSettled(last.id)
      await H.flush()
      gateResolved(T, 'approve')
      last = await nextTurn(T, known)
      known.push(last.id)
    }
    expect(halted(T)).toBe(false)

    // Lượt thật thứ 7 ⇒ chạm trần ⇒ halt. Đối chứng: bộ đếm chỉ tính lượt thật.
    h.finish(last.id)
    await H.waitSettled(last.id)
    await H.flush()
    gateResolved(T, 'approve')
    await H.waitFor(() => halted(T), 'halt vì trần lượt')
  })
})

describe('TC-14/TC-15 — kết thúc job điều phối', () => {
  test('TC-14: không có lượt hoãn / tin nhắn chờ ⇒ O1 xong không sinh lượt mới', async () => {
    const T = 'B14'
    const o1 = await busyOnly(T)
    h.finish(o1)
    await H.waitSettled(o1)
    await H.flush(40)
    expect(H.turnsOf(T)).toHaveLength(1)
  })

  test('TC-15: O1 (lượt quyết định) fail ⇒ lượt hoãn step_finished vẫn chạy, task không đứng', async () => {
    const T = 'B15'
    H.seedTask(h.root, T)
    const s1 = H.submitStep(h.root, T, 'investigator')
    await H.waitRunning(h, s1.id)
    // O1 là một lượt quyết định (manual_start), không phải chat.
    const o1 = turnJobId(await startOrchestratorTurn(h.root, H.PROJECT, T, 'manual_start'))
    await H.waitRunning(h, o1)
    h.finish(s1.id)
    await H.waitSettled(s1.id)
    await H.flush()
    expect(H.turnsOf(T)).toHaveLength(1)

    h.finish(o1, { ok: false })
    const replay = await nextTurn(T, [o1])
    expect(replay.metadata?.orchestratorTrigger).toBe('step_finished')
  })

  test('TC-15 (O1 là lượt chat như TC-08) fail ⇒ task bị halt (hành vi có sẵn), không mở lượt nào sau đó', async () => {
    // `recoverFromBadTurn` halt task khi lượt `chat` fail (trigger không thuộc
    // FALLBACK_TRIGGERS) — có từ trước; design E5 chấp nhận drain bỏ lượt hoãn khi
    // halted. Task không "đứng im lặng": nó ở trạng thái halted mà người dùng thấy,
    // và lưới sweep MỚI-2 nhặt lại sau khi bỏ halt (sweepBacklog.test.ts).
    const T = 'B15c'
    const { s1, o1 } = await busyWithChat(T)
    h.finish(s1)
    await H.waitSettled(s1)
    await H.flush()
    h.finish(o1, { ok: false })
    await H.waitSettled(o1)
    await H.waitFor(() => halted(T), 'halt sau khi lượt chat fail')
    await H.flush(40)
    expect(H.turnsOf(T)).toHaveLength(1)
    expect(H.stateOf(h.root, T).orchestrator_halted).toBe(true)
  })
})

describe('TC-16 — race: step và job điều phối kết thúc gần như cùng lúc (≥ 50 lần)', () => {
  test('mỗi lần: đúng 1 lượt step_finished, chạy ngay, không bao giờ 2 lượt cùng sống', async () => {
    for (let i = 0; i < 50; i++) {
      const T = `B16-${i}`
      const { s1, o1 } = await busyWithChat(T)
      const order = i % 2 === 0 ? [s1, o1] : [o1, s1]
      const gap = i % 5 // 0…4 ms giữa hai sự kiện
      h.finish(order[0])
      if (gap) await new Promise((r) => setTimeout(r, gap))
      h.finish(order[1])
      await H.waitSettled(s1)
      await H.waitSettled(o1)

      const replay = await nextTurn(T, [o1])
      await H.flush(10)
      assertAtMostOneLiveTurn(T)
      const stepTurns = H.turnsOf(T).filter((j) => j.metadata?.orchestratorTrigger === 'step_finished')
      expect(stepTurns.map((j) => j.id)).toEqual([replay.id])
      h.finish(replay.id)
      await H.waitSettled(replay.id)
    }
  }, 60_000)
})

describe('TC-17 — hai lượt không phải chat đến cùng lúc khi rảnh', () => {
  test('đúng 1 lượt chạy ngay, lượt kia hoãn và chạy sau; không bao giờ 2 lượt cùng sống', async () => {
    const T = 'B17'
    H.seedTask(h.root, T, { current_phase: 'implementer' })
    // Gọi thẳng hai đường vào, bỏ qua khoá `inFlight` của `handleEvent` (khoá đó
    // bỏ event trùng lúc — hành vi có từ trước, ngoài phạm vi; test-spec §4).
    await Promise.all([
      startOrchestratorTurn(h.root, H.PROJECT, T, 'manual_start'),
      handleEvent({
        type: 'hitl.resolved',
        at: new Date().toISOString(),
        payload: { taskId: T, devTeamRoot: h.root, projectId: H.PROJECT, action: 'approve', currentPhase: 'implementer' },
      }),
    ])
    await H.flush()
    expect(H.turnsOf(T)).toHaveLength(1)
    assertAtMostOneLiveTurn(T)
    const first = H.turnsOf(T)[0]
    await H.waitRunning(h, first.id)

    h.finish(first.id)
    const second = await nextTurn(T, [first.id])
    assertAtMostOneLiveTurn(T)
    expect(new Set([first, second].map((j) => j.metadata?.orchestratorTrigger))).toEqual(
      new Set(['manual_start', 'gate_approved']),
    )
  })
})

/* ── D. Tin nhắn chờ của nút điều phối (D3, D5) ───────────────────────────── */

describe('TC-21/TC-22/TC-23/TC-30 — xếp hàng và gộp tin nhắn chờ', () => {
  test('TC-21: chat khi bận ⇒ { queued: true }, không lượt thứ hai, lưu bền vào pending_orchestrator_chat', async () => {
    const T = 'D21'
    await busyOnly(T)
    const res = await chatWithOrchestrator(h.root, H.PROJECT, T, 'M1')
    expect(res).toEqual({ queued: true })
    await H.flush()
    expect(H.turnsOf(T)).toHaveLength(1)
    expect(pendingChat(T)).toEqual(['M1'])
    expect(typeof H.stateOf(h.root, T).pending_orchestrator_chat.queuedAt).toBe('string')
  })

  test('TC-22/TC-30: M1, M2, M3 khi bận ⇒ sau O1 đúng 1 lượt chat chứa cả ba theo thứ tự; hàng chờ rỗng', async () => {
    const T = 'D22'
    const o1 = await busyOnly(T)
    for (const m of ['M1-alpha', 'M2-beta', 'M3-gamma']) {
      expect(await chatWithOrchestrator(h.root, H.PROJECT, T, m)).toEqual({ queued: true })
    }
    expect(pendingChat(T)).toEqual(['M1-alpha', 'M2-beta', 'M3-gamma'])

    h.finish(o1)
    const chat = await nextTurn(T, [o1])
    await H.flush()
    expect(chat.metadata?.orchestratorTrigger).toBe('chat')
    expect(H.turnsOf(T)).toHaveLength(2)
    const p = String(chat.userPrompt)
    const idx = ['M1-alpha', 'M2-beta', 'M3-gamma'].map((m) => p.indexOf(m))
    expect(idx.every((n) => n >= 0)).toBe(true)
    expect(idx).toEqual([...idx].sort((a, b) => a - b))
    expect(p.split('M1-alpha')).toHaveLength(2) // không lặp
    expect(pendingChat(T)).toEqual([])

    // TC-23: tin nhắn chờ không lặp lại ở lượt sau.
    h.finish(chat.id)
    await H.waitSettled(chat.id)
    await H.flush()
    const res = await chatWithOrchestrator(h.root, H.PROJECT, T, 'M4-delta')
    expect('queued' in res).toBe(false)
    const m4 = H.turnsOf(T).find((j) => j.id === turnJobId(res))!
    expect(m4.userPrompt).toContain('M4-delta')
    expect(m4.userPrompt).not.toContain('M1-alpha')
  })
})

describe('TC-24 — tin nhắn chờ của nút điều phối tách biệt tin nhắn chờ của step', () => {
  test('M1 chỉ vào lượt chat của nút; F1 chỉ vào phiên step sau khi S1 xong', async () => {
    const T = 'D24'
    const { s1, o1 } = await busyWithChat(T)
    const fb = await sendTaskFeedback(T, H.PROJECT, 'F1-step', { stepId: 'investigator' })
    expect(fb.ok && 'queued' in fb).toBe(true)
    expect(await chatWithOrchestrator(h.root, H.PROJECT, T, 'M1-orch')).toEqual({ queued: true })

    const st = H.stateOf(h.root, T)
    expect(st.pending_feedback).toMatchObject({ feedback: 'F1-step' })
    expect(st.pending_orchestrator_chat.messages).toEqual(['M1-orch'])

    h.finish(o1)
    const chat = await nextTurn(T, [o1])
    expect(chat.userPrompt).toContain('M1-orch')
    expect(chat.userPrompt).not.toContain('F1-step')
    expect(H.stateOf(h.root, T).pending_feedback).toMatchObject({ feedback: 'F1-step' })

    h.finish(chat.id)
    h.finish(s1)
    await H.waitSettled(s1)
    const fbJob = await H.waitFor(
      () => H.jobsOf(T).find((j) => j.metadata?.isChatFeedback === true),
      'chat-feedback F1 của step',
    )
    expect(fbJob.userPrompt).toContain('F1-step')
    expect(fbJob.userPrompt).not.toContain('M1-orch')
    await H.flush(40)
    expect(H.turnsOf(T).some((j) => String(j.userPrompt).includes('F1-step'))).toBe(false)
  })
})

describe('TC-26 — race: tin nhắn đến đúng lúc job điều phối kết thúc (≥ 50 lần)', () => {
  test('mỗi lần: Mi xử lý đúng 1 lần, không 409, không kẹt trong hàng chờ', async () => {
    for (let i = 0; i < 50; i++) {
      const T = `D26-${i}`
      const o1 = await busyOnly(T)
      const msg = `Mi-${i}-xyz`
      const gap = i % 4
      let res: unknown
      if (i % 2 === 0) {
        h.finish(o1)
        if (gap) await new Promise((r) => setTimeout(r, gap))
        res = await chatWithOrchestrator(h.root, H.PROJECT, T, msg)
      } else {
        const p = chatWithOrchestrator(h.root, H.PROJECT, T, msg)
        if (gap) await new Promise((r) => setTimeout(r, gap))
        h.finish(o1)
        res = await p
      }
      expect(res && typeof res === 'object' && 'error' in res).toBe(false)
      await H.waitSettled(o1)

      const carrier = await H.waitFor(
        () => H.turnsOf(T).find((j) => j.id !== o1 && String(j.userPrompt).includes(msg)),
        `lượt chứa ${msg}`,
      )
      await H.flush(5)
      expect(H.turnsOf(T).filter((j) => String(j.userPrompt).includes(msg))).toHaveLength(1)
      expect(pendingChat(T)).toEqual([])
      await H.waitRunning(h, carrier.id)
      h.finish(carrier.id)
      await H.waitSettled(carrier.id)
    }
  }, 60_000)
})

/* ── E. Thứ tự lượt hoãn và tin nhắn chờ (D6) ─────────────────────────────── */

describe('TC-28/TC-29 — lượt hoãn chạy trước, tin nhắn chờ sau', () => {
  test('step_finished hoãn + M1, M2 ⇒ step_finished trước; M3 đến lúc đó gộp vào lượt chat sau', async () => {
    const T = 'E28'
    const { s1, o1 } = await busyWithChat(T)
    h.finish(s1)
    await H.waitSettled(s1)
    await H.flush()
    expect(await chatWithOrchestrator(h.root, H.PROJECT, T, 'M1-a')).toEqual({ queued: true })
    expect(await chatWithOrchestrator(h.root, H.PROJECT, T, 'M2-b')).toEqual({ queued: true })

    h.finish(o1)
    const deferred = await nextTurn(T, [o1])
    expect(deferred.metadata?.orchestratorTrigger).toBe('step_finished')
    await H.flush()
    assertAtMostOneLiveTurn(T)
    expect(pendingChat(T)).toEqual(['M1-a', 'M2-b'])

    // TC-29: tin mới khi lượt hoãn đang chạy.
    expect(await chatWithOrchestrator(h.root, H.PROJECT, T, 'M3-c')).toEqual({ queued: true })

    h.finish(deferred.id)
    const chat = await nextTurn(T, [o1, deferred.id])
    expect(chat.metadata?.orchestratorTrigger).toBe('chat')
    const p = String(chat.userPrompt)
    const idx = ['M1-a', 'M2-b', 'M3-c'].map((m) => p.indexOf(m))
    expect(idx.every((n) => n >= 0)).toBe(true)
    expect(idx).toEqual([...idx].sort((a, b) => a - b))
    await H.flush(40)
    expect(H.turnsOf(T)).toHaveLength(3)
    expect(pendingChat(T)).toEqual([])
  })
})

describe('design §5 (7) — nút điều phối tắt khi còn việc treo', () => {
  test('drain bỏ lượt hoãn và xoá hàng chờ, không mở lượt nào', async () => {
    const T = 'E-off'
    const o1 = await busyOnly(T, { current_phase: 'implementer' })
    gateResolved(T, 'approve')
    await H.flush()
    expect(await chatWithOrchestrator(h.root, H.PROJECT, T, 'M-off')).toEqual({ queued: true })

    // Tắt nút điều phối cho task trước khi O1 xong.
    H.writePipeline(h.root, { enabled: false })
    const st = H.stateOf(h.root, T)
    await Bun.write(`${h.root}/.dev-state/${T}.json`, JSON.stringify({ ...st, orchestrator_enabled: false }))

    h.finish(o1)
    await H.waitSettled(o1)
    await H.flush(40)
    await drainOrchestratorBacklog({ root: h.root, taskId: T, projectId: H.PROJECT })
    expect(H.turnsOf(T)).toHaveLength(1)
    expect(pendingChat(T)).toEqual([])
  })
})
