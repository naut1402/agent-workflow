import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  loadJob,
  loadTaskSessionLedger,
  registerProvider,
  sendTaskFeedback,
  submitJob,
  upsertConnection,
  upsertRunner,
} from '../../../../src/features/runner/business/index.js'
import { parseOrchestratorDecision } from '../../../../src/features/runner/business/jobQueue.js'
import { saveTaskSessionLedger, type SessionEntry } from '../../../../src/features/runner/business/sessionLedger.js'
import type { ExecuteRequest, ExecuteResult, RunnerProvider } from '../../../../src/features/runner/business/types.js'
import { ORCHESTRATOR_STEP_ID } from '../../../../src/shared/lib/orchestrator.js'

/*
 * Td2be3c3e TC10 — regression guard: kênh chat trực tiếp với một step riêng lẻ
 * (bridge "chat → dispatch step" ở `tryDispatchOrchestratorDecision`) chỉ hỗ
 * trợ `start`/`resume` (design.md §6, comment sẵn có `SUPPORTED_ORCHESTRATOR_ACTIONS`
 * ở jobQueue.ts:44) — `respawn` cố ý KHÔNG được mở rộng vào đây, nó chỉ đi qua
 * `applyDecision`/`ACTION_HANDLERS` (API `POST /api/orchestrator/decide` hoặc
 * sentinel line của chính job orchestrator, xem decisionLoop.ts).
 */

describe('parseOrchestratorDecision — chỉ nhận start/resume (Td2be3c3e TC10)', () => {
  test('start được nhận diện', () => {
    expect(parseOrchestratorDecision('ORCHESTRATOR_DECISION: {"action":"start","stepId":"implementer"}')).toEqual({
      action: 'start',
      stepId: 'implementer',
    })
  })

  test('resume được nhận diện', () => {
    expect(parseOrchestratorDecision('ORCHESTRATOR_DECISION: {"action":"resume","stepId":"implementer"}')).toEqual({
      action: 'resume',
      stepId: 'implementer',
    })
  })

  test('respawn KHÔNG được nhận diện qua kênh này — trả null, không áp dụng gì', () => {
    expect(
      parseOrchestratorDecision('ORCHESTRATOR_DECISION: {"action":"respawn","stepId":"implementer"}'),
    ).toBeNull()
  })

  test('respawn lẫn giữa nhiều dòng — vẫn không được nhận diện dù là dòng cuối', () => {
    const stdout = [
      'Tôi nghĩ nên chạy lại implementer.',
      'ORCHESTRATOR_DECISION: {"action":"respawn","stepId":"implementer","context":"revert filter"}',
    ].join('\n')
    expect(parseOrchestratorDecision(stdout)).toBeNull()
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * T6427b18c — nhóm B: khe hở ở đường dispatch/feedback.
 *
 * Hai chỗ `jobQueue` hỏi ledger mà trước đây không nói mình là node nào:
 *   - `sendTaskFeedback` — "còn phiên mở nào không" ⇒ phản hồi cho step A nối
 *     vào phiên đang mở của nút điều phối;
 *   - `runJob` nhánh `resume` — entry chỉ được ghi khi job XONG, nên suốt lượt
 *     chạy không có entry nào mang `stepId` của node đang chạy.
 *
 * Bề mặt chấm: `sessionMode` của job được submit (đọc lại qua
 * `metadata.inputSessionMode` của job record) và ledger trên đĩa.
 * ──────────────────────────────────────────────────────────────────────────── */

const FB_PROVIDER = 'stub-node-isolation'
const PROJECT = 'P-node-iso'
const STEP_A = 'implementer'
const STEP_B = 'reviewer'
const ORCH = ORCHESTRATOR_STEP_ID

let home: string
let root: string
const savedEnv = { ...process.env }

/** Ảnh chụp ledger NGAY trong lúc provider đang chạy — cửa sổ mà TC-24 đo. */
const ledgerAtStart: Array<{ taskId: string; sessions: SessionEntry[] }> = []

const stubProvider: RunnerProvider = {
  providerId: FB_PROVIDER,
  validateRunnerConfig: () => ({ ok: true, errors: [] }),
  validateCredential: () => ({ ok: true, errors: [] }),
  capabilities: () => ({ supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }),
  async execute(req: ExecuteRequest): Promise<ExecuteResult> {
    const taskId = String((req as any).metadata?.taskId ?? '')
    if (taskId) ledgerAtStart.push({ taskId, sessions: loadTaskSessionLedger(PROJECT, taskId).sessions })
    return { ok: true, exitCode: 0, durationMs: 1 }
  },
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function settle(id: string) {
  for (let i = 0; i < 400; i++) {
    const j = loadJob(id)
    if (j && j.status !== 'queued' && j.status !== 'running') return j
    await sleep(5)
  }
  throw new Error(`job ${id} never settled (status=${loadJob(id)?.status})`)
}

function seedTask(taskId: string): void {
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tasks', taskId), { recursive: true })
  fs.writeFileSync(
    path.join(root, '.dev-state', `${taskId}.json`),
    JSON.stringify({ task_id: taskId, current_phase: STEP_A }),
    'utf8',
  )
  fs.writeFileSync(path.join(root, 'tasks', taskId, 'request.md'), '# request\n', 'utf8')
}

function stepJob(taskId: string, stepId: string | null, sessionMode?: 'new' | 'resume') {
  return submitJob({
    runnerId: 'stub-runner-node-iso',
    agentRef: '',
    workspace: path.join(root, 'tasks', taskId),
    userPrompt: 'làm việc đi',
    ...(sessionMode ? { sessionMode } : {}),
    metadata: {
      projectRoot: path.dirname(root),
      devTeamRoot: root,
      projectId: PROJECT,
      taskId,
      ...(stepId ? { pipelineStepId: stepId } : {}),
    },
  })
}

function isoEntry(over: Partial<SessionEntry> & { sessionId: string }, taskId: string): SessionEntry {
  return {
    providerId: FB_PROVIDER,
    runnerId: 'stub-runner-node-iso',
    connectionId: 'stub-conn-node-iso',
    workspace: path.join(root, 'tasks', taskId),
    host: os.hostname(),
    stepIds: [],
    status: 'open',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastUsedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function seedLedger(taskId: string, sessions: SessionEntry[]): void {
  saveTaskSessionLedger(PROJECT, { version: 1, taskId, sessionPolicy: 'single', sessions })
}

function byId(taskId: string): Record<string, SessionEntry> {
  return Object.fromEntries(loadTaskSessionLedger(PROJECT, taskId).sessions.map((s) => [String(s.sessionId), s]))
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-node-iso-home-'))
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-node-iso-root-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  registerProvider(stubProvider)
  upsertConnection({ id: 'stub-conn-node-iso', kind: 'local-console', providerId: FB_PROVIDER, cliPath: 'stub' })
  upsertRunner({ id: 'stub-runner-node-iso', connectionId: 'stub-conn-node-iso', config: {} })
  // `reviewer` không khai agent ⇒ chuỗi auto-advance dừng ngay sau `implementer`,
  // không có job thứ hai chạy đua với assertion (cùng lý do `jobFeedback.test.ts`).
  fs.writeFileSync(
    path.join(root, 'pipeline.yaml'),
    ['version: 1', 'steps:', `  - id: ${STEP_A}`, "    agent: ' '", `  - id: ${STEP_B}`].join('\n'),
    'utf8',
  )
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(root, { recursive: true, force: true })
})
beforeEach(() => {
  ledgerAtStart.length = 0
})

describe('T6427b18c nhóm B — sendTaskFeedback lọc phiên theo node', () => {
  test('TC-21: chỉ có phiên nút điều phối đang mở ⇒ phản hồi cho step A mở phiên MỚI', async () => {
    const T = 'B21'
    seedTask(T)
    const parent = stepJob(T, STEP_A)
    await settle(parent.id)
    seedLedger(T, [isoEntry({ sessionId: 's-orch', stepIds: [ORCH] }, T)])

    const res = await sendTaskFeedback(T, PROJECT, 'phản hồi cho implementer', { stepId: STEP_A })
    expect(res.ok).toBe(true)
    if (!res.ok || 'queued' in res) throw new Error('unexpected result')
    expect(res.job.parentJobId).toBe(parent.id)
    expect(res.job.metadata?.inputSessionMode).toBe('new')
    await settle(res.job.id)

    // Phiên điều phối không bị chiếm dụng: cùng sessionId, vẫn mở, vẫn một node.
    const orch = byId(T)['s-orch']
    expect(orch).toMatchObject({ sessionId: 's-orch', status: 'open' })
    expect(orch.stepIds).toEqual([ORCH])
  })

  test('TC-22: phiên của chính step A đang mở ⇒ resume ĐÚNG phiên đó (đối chứng)', async () => {
    const T = 'B22'
    seedTask(T)
    const parent = stepJob(T, STEP_A)
    await settle(parent.id)
    seedLedger(T, [
      isoEntry({ sessionId: 's-orch', stepIds: [ORCH] }, T),
      isoEntry({ sessionId: 's-a', stepIds: [STEP_A] }, T),
    ])

    const res = await sendTaskFeedback(T, PROJECT, 'phản hồi', { stepId: STEP_A })
    if (!res.ok || 'queued' in res) throw new Error('unexpected result')
    expect(res.job.metadata?.inputSessionMode).toBe('resume')
    const done = await settle(res.job.id)
    // Session thật sự được nối là của step A, không phải của nút điều phối.
    expect(done.sessionId).toBe('s-a')
  })

  test('TC-23: parent không có stepId ⇒ giữ nguyên hành vi cũ (có entry mở nào thì nối)', async () => {
    const T = 'B23'
    seedTask(T)
    const parent = stepJob(T, null)
    await settle(parent.id)
    seedLedger(T, [isoEntry({ sessionId: 's-x', stepIds: [STEP_B] }, T)])

    const res = await sendTaskFeedback(T, PROJECT, 'phản hồi ad-hoc')
    if (!res.ok || 'queued' in res) throw new Error('unexpected result')
    expect(res.job.parentJobId).toBe(parent.id)
    expect(res.job.metadata?.inputSessionMode).toBe('resume')
    await settle(res.job.id)
  })
})

describe('T6427b18c nhóm B — runJob ghi quyền sở hữu ngay lúc start', () => {
  test('TC-24: job resume có entry mang stepId của mình NGAY trong lúc chạy', async () => {
    const T = 'B24'
    seedTask(T)
    seedLedger(T, [isoEntry({ sessionId: 's-a', stepIds: [STEP_A] }, T)])

    const job = stepJob(T, STEP_A, 'resume')
    await settle(job.id)

    // Ảnh chụp lấy TRONG `provider.execute`, tức là trước khi job kết thúc.
    const snap = ledgerAtStart.find((s) => s.taskId === T)
    expect(snap).toBeTruthy()
    const own = snap!.sessions.find((s) => s.sessionId === 's-a')!
    expect(own.status).toBe('open')
    expect(own.stepIds).toContain(STEP_A)
    expect(Date.parse(own.lastUsedAt)).toBeGreaterThan(Date.parse('2026-01-01T00:00:00.000Z'))
  })

  test('TC-25: job resume không stale entry nào — phiên điều phối vẫn mở', async () => {
    const T = 'B25'
    seedTask(T)
    seedLedger(T, [
      isoEntry({ sessionId: 's-orch', stepIds: [ORCH] }, T),
      isoEntry({ sessionId: 's-a', stepIds: [STEP_A] }, T),
    ])

    const job = stepJob(T, STEP_A, 'resume')
    await settle(job.id)

    const snap = ledgerAtStart.find((s) => s.taskId === T)!
    for (const id of ['s-orch', 's-a']) {
      const e = snap.sessions.find((s) => s.sessionId === id)!
      expect(e.status).toBe('open')
      expect(e.staleReason).toBeUndefined()
    }
    for (const id of ['s-orch', 's-a']) {
      expect(byId(T)[id].status).toBe('open')
      expect(byId(T)[id].staleReason).toBeUndefined()
    }
  })
})
