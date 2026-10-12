import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import type { DashboardEvent } from '../../../../src/backend/events/index.js'
import { chatWithOrchestrator } from '../../../../src/features/orchestrator/business/decisionLoop.js'
import { loadJob, sendTaskFeedback, submitJob } from '../../../../src/features/runner/business/index.js'
import * as H from './parallelHarness.js'

/*
 * Ted0cf9ac — nhóm A (D1): làn riêng của job điều phối trong `jobQueue`.
 *
 * Bề mặt chấm: trạng thái job (`queued` / `running` / kết thúc) qua job record,
 * và thứ tự job vào `provider.execute`. Job giả lập giữ `running` tới khi test
 * cho kết thúc — xem `parallelHarness.ts`.
 *
 * Phủ TC-01 → TC-07 và TC-33 / TC-33a (gửi lại feedback chờ của step).
 */

let h: H.Harness
const seen: DashboardEvent[] = []

function turnJobId(res: unknown): string {
  if (!res || typeof res !== 'object' || !('job' in res)) throw new Error(`không có job: ${JSON.stringify(res)}`)
  return (res as { job: { id: string } }).job.id
}

beforeAll(() => {
  h = H.setupHarness('lane')
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

describe('TC-01/TC-02 — chat với nút điều phối không chờ job step', () => {
  test('TC-01: step đang chạy ⇒ lượt chat chạy NGAY, cùng running với step, xong trước step', async () => {
    H.seedTask(h.root, 'A01')
    const s1 = H.submitStep(h.root, 'A01', 'investigator')
    await H.waitRunning(h, s1.id)

    const res = await chatWithOrchestrator(h.root, H.PROJECT, 'A01', 'tình hình thế nào?')
    expect('queued' in res).toBe(false)
    const o1 = turnJobId(res)
    await H.waitRunning(h, o1)

    // Cả hai cùng `running` tại một thời điểm.
    expect(H.statusOf(s1.id)).toBe('running')
    expect(H.statusOf(o1)).toBe('running')

    h.finish(o1)
    await H.waitSettled(o1)
    expect(H.statusOf(o1)).toBe('succeeded')
    // O1 xong trước khi S1 xong; S1 không bị huỷ / khởi động lại.
    expect(H.statusOf(s1.id)).toBe('running')
    expect(h.started.filter((id) => id === s1.id)).toHaveLength(1)

    h.finish(s1.id, { stdout: 'STEP-OUT\nSTEP_SUMMARY: điều tra xong' })
    const s1Done = await H.waitSettled(s1.id)
    expect(s1Done.status).toBe('succeeded')
    expect(s1Done.metadata?.stepSummary).toBe('điều tra xong')
  })

  test('TC-02: task rảnh ⇒ lượt chat chạy và kết thúc như cũ', async () => {
    H.seedTask(h.root, 'A02')
    const res = await chatWithOrchestrator(h.root, H.PROJECT, 'A02', 'xin chào')
    expect('queued' in res).toBe(false)
    const o1 = turnJobId(res)
    expect(loadJob(o1)?.metadata?.orchestratorTrigger).toBe('chat')
    await H.waitRunning(h, o1)
    h.finish(o1)
    expect((await H.waitSettled(o1)).status).toBe('succeeded')
  })
})

describe('TC-03 — job step không bị chặn bởi job điều phối', () => {
  test('job điều phối đang chạy ⇒ job step submit sau chạy ngay', async () => {
    H.seedTask(h.root, 'A03')
    const o1 = turnJobId(await chatWithOrchestrator(h.root, H.PROJECT, 'A03', 'bắt đầu'))
    await H.waitRunning(h, o1)

    const s1 = H.submitStep(h.root, 'A03', 'investigator')
    await H.waitRunning(h, s1.id)
    expect(H.statusOf(o1)).toBe('running')
  })
})

describe('TC-04 — hai job điều phối của cùng task vẫn tuần tự', () => {
  for (const o1Outcome of ['done', 'failed'] as const) {
    test(`O1 kết thúc ${o1Outcome} ⇒ O2 chỉ running sau đó, không lúc nào chồng nhau`, async () => {
      const T = `A04-${o1Outcome}`
      H.seedTask(h.root, T)
      const o1 = H.submitOrchestratorJob(h.root, T, 'chat')
      await H.waitRunning(h, o1.id)
      const o2 = H.submitOrchestratorJob(h.root, T, 'chat')

      await H.flush()
      expect(H.statusOf(o2.id)).toBe('queued')
      expect(H.runningOf(T).filter((j) => j.metadata?.orchestratorJob === true)).toHaveLength(1)

      h.finish(o1.id, { ok: o1Outcome === 'done' })
      await H.waitSettled(o1.id)
      // O2 không kẹt `queued`, kể cả khi O1 fail.
      await H.waitRunning(h, o2.id)
      expect(H.statusOf(o1.id)).toBe(o1Outcome === 'done' ? 'succeeded' : 'failed')
      expect(h.started.indexOf(o2.id)).toBeGreaterThan(h.started.indexOf(o1.id))
    })
  }
})

describe('TC-05 — job step của cùng task vẫn tuần tự với nhau', () => {
  test('(a) chat-feedback của step khi S1 chạy ⇒ xếp hàng theo hành vi cũ, không chạy song song', async () => {
    H.seedTask(h.root, 'A05a')
    const s1 = H.submitStep(h.root, 'A05a', 'investigator')
    await H.waitRunning(h, s1.id)

    const res = await sendTaskFeedback('A05a', H.PROJECT, 'sửa lại giúp', { stepId: 'investigator' })
    expect(res.ok).toBe(true)
    expect(res.ok && 'queued' in res).toBe(true)
    await H.flush()
    expect(H.runningOf('A05a').filter((j) => j.metadata?.orchestratorJob !== true)).toHaveLength(1)
  })

  test('(b) respawn và (c) step S2 khi S1 chạy ⇒ queued, chạy lần lượt sau S1; tối đa 1 job step running', async () => {
    const T = 'A05bc'
    H.seedTask(h.root, T)
    const s1 = H.submitStep(h.root, T, 'investigator')
    await H.waitRunning(h, s1.id)
    const respawn = H.submitStep(h.root, T, 'investigator', { respawn: true })
    const s2 = H.submitStep(h.root, T, 'implementer')
    await H.flush()

    const stepRunning = () => H.runningOf(T).filter((j) => j.metadata?.orchestratorJob !== true)
    expect(H.statusOf(respawn.id)).toBe('queued')
    expect(H.statusOf(s2.id)).toBe('queued')
    expect(stepRunning()).toHaveLength(1)

    h.finish(s1.id)
    await H.waitRunning(h, respawn.id)
    expect(H.statusOf(s2.id)).toBe('queued')
    expect(stepRunning()).toHaveLength(1)

    h.finish(respawn.id)
    await H.waitRunning(h, s2.id)
    expect(stepRunning()).toHaveLength(1)
  })
})

describe('TC-06 — job của các task khác nhau không chờ nhau', () => {
  test('T1 có step chạy, T2 có lượt điều phối chạy ⇒ chat T1 và step T2 đều chạy ngay', async () => {
    H.seedTask(h.root, 'A06a')
    H.seedTask(h.root, 'A06b')
    const s1 = H.submitStep(h.root, 'A06a', 'investigator')
    const o2 = H.submitOrchestratorJob(h.root, 'A06b', 'chat')
    await H.waitRunning(h, s1.id)
    await H.waitRunning(h, o2.id)

    const o1 = turnJobId(await chatWithOrchestrator(h.root, H.PROJECT, 'A06a', 'hỏi T1'))
    const s2 = H.submitStep(h.root, 'A06b', 'investigator')
    await H.waitRunning(h, o1)
    await H.waitRunning(h, s2.id)
  })
})

describe('TC-07 — job không thuộc task nào không bị khoá theo task', () => {
  test('S1 và O1 cùng running ⇒ job không taskId vẫn chạy ngay', async () => {
    H.seedTask(h.root, 'A07')
    const s1 = H.submitStep(h.root, 'A07', 'investigator')
    await H.waitRunning(h, s1.id)
    const o1 = turnJobId(await chatWithOrchestrator(h.root, H.PROJECT, 'A07', 'hỏi'))
    await H.waitRunning(h, o1)

    const free = submitJob({
      agentRef: '',
      workspace: h.root,
      userPrompt: 'nl-chat',
      metadata: { isNlChat: true },
    })
    await H.waitRunning(h, free.id)
  })
})

describe('TC-33/TC-33a — feedback chờ của step không bị gửi nhầm khi job điều phối xong', () => {
  function pendingFeedbackOf(taskId: string) {
    return H.stateOf(h.root, taskId).pending_feedback ?? null
  }
  function chatFeedbackJobs(taskId: string) {
    return H.jobsOf(taskId).filter((j) => j.metadata?.isChatFeedback === true)
  }

  test('TC-33: O1 xong khi S1 còn chạy ⇒ F1 vẫn chờ; S1 xong ⇒ F1 gửi vào phiên step đúng 1 lần', async () => {
    const T = 'A33'
    H.seedTask(h.root, T)
    const s1 = H.submitStep(h.root, T, 'investigator')
    await H.waitRunning(h, s1.id)
    const fb = await sendTaskFeedback(T, H.PROJECT, 'F1', { stepId: 'investigator' })
    expect(fb.ok && 'queued' in fb).toBe(true)
    expect(pendingFeedbackOf(T)).toMatchObject({ feedback: 'F1' })

    const o1 = turnJobId(await chatWithOrchestrator(h.root, H.PROJECT, T, 'hỏi nút điều phối'))
    await H.waitRunning(h, o1)
    h.finish(o1)
    await H.waitSettled(o1)
    await H.flush()

    // Lúc O1 kết thúc: F1 KHÔNG được gửi.
    expect(chatFeedbackJobs(T)).toHaveLength(0)
    expect(pendingFeedbackOf(T)).toMatchObject({ feedback: 'F1' })

    h.finish(s1.id)
    await H.waitSettled(s1.id)
    const sent = await H.waitFor(() => chatFeedbackJobs(T)[0], 'chat-feedback F1')
    await H.flush()
    expect(chatFeedbackJobs(T)).toHaveLength(1)
    expect(sent.userPrompt).toContain('F1')
    expect(sent.metadata?.orchestratorJob).toBeUndefined()
    expect(pendingFeedbackOf(T)).toBeNull()
  })

  test('TC-33a: không bật nút điều phối ⇒ S1 xong thì F1 gửi vào phiên step đúng 1 lần (như cũ)', async () => {
    // Bước kế KHÔNG khai agent ⇒ chuỗi auto-advance dừng sau investigator, không
    // có job step thứ hai làm F1 bị xếp hàng lại (cùng lý do `jobFeedback.test.ts`).
    fs.writeFileSync(
      path.join(h.root, 'pipeline.yaml'),
      ['version: 1', 'steps:', '  - { id: investigator, agent: " " }', '  - { id: implementer }'].join('\n'),
      'utf8',
    )
    const T = 'A33a'
    H.seedTask(h.root, T, { orchestrator_enabled: false })
    const s1 = H.submitStep(h.root, T, 'investigator')
    await H.waitRunning(h, s1.id)
    const fb = await sendTaskFeedback(T, H.PROJECT, 'F1', { stepId: 'investigator' })
    expect(fb.ok && 'queued' in fb).toBe(true)

    h.finish(s1.id)
    await H.waitSettled(s1.id)
    const sent = await H.waitFor(() => chatFeedbackJobs(T)[0], 'chat-feedback F1')
    await H.flush()
    expect(chatFeedbackJobs(T)).toHaveLength(1)
    expect(sent.userPrompt).toContain('F1')
    expect(sent.parentJobId).toBe(s1.id)
    expect(H.turnsOf(T)).toHaveLength(0)
  })
})
