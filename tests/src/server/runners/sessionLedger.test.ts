import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  closeTaskSession,
  isSessionEntryValid,
  loadTaskSessionLedger,
  recordSessionUsage,
  resolveSessionPlan,
  saveTaskSessionLedger,
  type SessionEntry,
} from '../../../../src/features/runner/business/sessionLedger.js'
import { ORCHESTRATOR_STEP_ID } from '../../../../src/shared/lib/orchestrator.js'

let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME
const PROJECT = 'proj-a'
const TASK = 'F0010'

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-ledger-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})

afterAll(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

function seedOpenSession(overrides: Partial<SessionEntry> = {}): SessionEntry {
  const entry: SessionEntry = {
    sessionId: 'sess-open-1',
    providerId: 'claude-code-cli',
    runnerId: 'r1',
    connectionId: 'claude-code-cli-local',
    workspace: '/tmp/ws',
    host: os.hostname(),
    stepIds: ['investigate'],
    status: 'open',
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    ...overrides,
  }
  saveTaskSessionLedger(PROJECT, {
    version: 1,
    taskId: TASK,
    sessionPolicy: 'single',
    sessions: [entry],
  })
  return entry
}

describe('sessionLedger', () => {
  test('resolveSessionPlan resume uses open ledger entry (single policy)', () => {
    seedOpenSession()
    const plan = resolveSessionPlan({
      projectId: PROJECT,
      taskId: TASK,
      sessionMode: 'resume',
      providerId: 'claude-code-cli',
      runnerId: 'r1',
      connectionId: 'claude-code-cli-local',
      workspace: '/tmp/ws',
      host: os.hostname(),
    })
    expect(plan.sessionMode).toBe('resume')
    expect(plan.resumeSessionId).toBe('sess-open-1')
  })

  test('resolveSessionPlan resume invalid on host change → new + staleReason', () => {
    seedOpenSession({ host: 'other-machine' })
    const plan = resolveSessionPlan({
      projectId: PROJECT,
      taskId: TASK,
      sessionMode: 'resume',
      providerId: 'claude-code-cli',
      runnerId: 'r1',
      connectionId: 'claude-code-cli-local',
      workspace: '/tmp/ws',
      host: os.hostname(),
    })
    expect(plan.sessionMode).toBe('new')
    expect(plan.staleReason).toBe('host changed')
  })

  test('resolveSessionPlan resume invalid on workspace change', () => {
    seedOpenSession({ workspace: '/other/scratch/proposals/job-1' })
    const plan = resolveSessionPlan({
      projectId: PROJECT,
      taskId: TASK,
      sessionMode: 'resume',
      providerId: 'claude-code-cli',
      runnerId: 'r1',
      connectionId: 'claude-code-cli-local',
      workspace: '/tmp/ws',
      host: os.hostname(),
    })
    expect(plan.sessionMode).toBe('new')
    expect(plan.staleReason).toBe('workspace changed')
  })

  test('resolveSessionPlan resume invalid when session archived', () => {
    const entry = seedOpenSession({ status: 'archived' })
    const check = isSessionEntryValid(entry, {
      host: os.hostname(),
      workspace: '/tmp/ws',
      providerId: 'claude-code-cli',
      connectionId: 'claude-code-cli-local',
    })
    expect(check.invalid).toBe(true)
    expect(check.reason).toBe('session archived')
  })

  test('recordSessionUsage forceNew marks prior open entry stale', () => {
    seedOpenSession()
    recordSessionUsage({
      projectId: PROJECT,
      taskId: TASK,
      sessionId: 'sess-new-2',
      providerId: 'claude-code-cli',
      runnerId: 'r1',
      connectionId: 'claude-code-cli-local',
      workspace: '/tmp/ws',
      forceNew: true,
      staleReason: 'provider changed',
    })
    const ledger = loadTaskSessionLedger(PROJECT, TASK)
    expect(ledger.sessions.filter((s) => s.status === 'stale').length).toBe(1)
    expect(ledger.sessions.find((s) => s.status === 'open')?.sessionId).toBe('sess-new-2')
  })

  test('sessionMode none → no resume id', () => {
    seedOpenSession()
    const plan = resolveSessionPlan({
      projectId: PROJECT,
      taskId: TASK,
      sessionMode: 'none',
      providerId: 'claude-code-cli',
      runnerId: 'r1',
      connectionId: 'claude-code-cli-local',
      workspace: '/tmp/ws',
    })
    expect(plan).toEqual({ sessionMode: 'none' })
  })

  test('closeTaskSession with stepId only closes the entry for that step', () => {
    saveTaskSessionLedger(PROJECT, {
      version: 1,
      taskId: TASK,
      sessionPolicy: 'per-step',
      sessions: [
        seedEntry({ sessionId: 'sess-design', stepIds: ['design'], status: 'open' }),
        seedEntry({ sessionId: 'sess-implement', stepIds: ['implement'], status: 'open' }),
      ],
    })
    closeTaskSession(PROJECT, TASK, { stepId: 'design' })
    const ledger = loadTaskSessionLedger(PROJECT, TASK)
    expect(ledger.sessions.find((s) => s.sessionId === 'sess-design')?.status).toBe('closed')
    expect(ledger.sessions.find((s) => s.sessionId === 'sess-implement')?.status).toBe('open')
  })

  test('closeTaskSession without opts closes every open entry (backward compat)', () => {
    saveTaskSessionLedger(PROJECT, {
      version: 1,
      taskId: TASK,
      sessionPolicy: 'per-step',
      sessions: [
        seedEntry({ sessionId: 'sess-design', stepIds: ['design'], status: 'open' }),
        seedEntry({ sessionId: 'sess-implement', stepIds: ['implement'], status: 'open' }),
      ],
    })
    closeTaskSession(PROJECT, TASK)
    const ledger = loadTaskSessionLedger(PROJECT, TASK)
    expect(ledger.sessions.every((s) => s.status === 'closed')).toBe(true)
  })
})

function seedEntry(overrides: Partial<SessionEntry> & { sessionId: string }): SessionEntry {
  return {
    providerId: 'claude-code-cli',
    runnerId: 'r1',
    connectionId: 'claude-code-cli-local',
    workspace: '/tmp/ws',
    host: os.hostname(),
    stepIds: [],
    status: 'open',
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    ...overrides,
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * T6427b18c — nhóm A: cách ly session theo NODE.
 *
 * Bug gốc: ledger giữ đúng một ô session cho cả task, nên job của một step ghi
 * đè `sessionId` của nút điều phối và từ lượt sau cha resume thẳng vào phiên
 * của con. Mọi case dưới đây chấm trên thứ quan sát được từ ngoài: ledger đọc
 * lại từ đĩa, và giá trị `resolveSessionPlan` trả về.
 *
 * Mỗi case dùng một taskId riêng — ledger là một file theo task, nên tách task
 * là tách hẳn trạng thái, không phụ thuộc thứ tự chạy.
 * ──────────────────────────────────────────────────────────────────────────── */

const ORCH = ORCHESTRATOR_STEP_ID
const STEP_A = 'investigator'
const STEP_B = 'reviewer'
const WS = '/tmp/ws'

/** Meta khớp `isSessionEntryValid` để mọi entry seed đều resume được. */
const META = {
  providerId: 'claude-code-cli',
  runnerId: 'r1',
  connectionId: 'claude-code-cli-local',
  workspace: WS,
  host: os.hostname(),
}

function entry(over: Partial<SessionEntry> & { sessionId: string }): SessionEntry {
  return {
    ...META,
    stepIds: [],
    status: 'open',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastUsedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

/**
 * Ghi thẳng file ledger. Cố ý KHÔNG đi qua `recordSessionUsage`: một phần case
 * ở đây cần dựng trạng thái *lai* mà API mới không còn tạo ra được nữa.
 */
function seedLedger(taskId: string, sessions: SessionEntry[], extra: Record<string, unknown> = {}): void {
  const dir = path.join(home, 'sessions', PROJECT)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${taskId}.json`),
    JSON.stringify({ version: 1, taskId, sessionPolicy: 'single', sessions, ...extra }, null, 2),
    'utf8',
  )
}

function rawLedger(taskId: string): any {
  return JSON.parse(fs.readFileSync(path.join(home, 'sessions', PROJECT, `${taskId}.json`), 'utf8'))
}

function record(taskId: string, over: Record<string, unknown>): void {
  recordSessionUsage({ projectId: PROJECT, taskId, sessionId: null, ...META, ...over } as any)
}

function plan(taskId: string, over: Record<string, unknown> = {}) {
  return resolveSessionPlan({
    projectId: PROJECT,
    taskId,
    sessionMode: 'resume',
    ...META,
    ...over,
  } as any)
}

describe('T6427b18c nhóm A — mỗi node một ô session', () => {
  test('TC-01: hai node giữ hai ô session `open` độc lập', () => {
    const T = 'A01'
    record(T, { sessionId: 's-orch', stepId: ORCH, forceNew: true })
    record(T, { sessionId: 's-a', stepId: STEP_A, forceNew: true })

    const { sessions } = loadTaskSessionLedger(PROJECT, T)
    expect(sessions).toHaveLength(2)
    expect(sessions.every((s) => s.status === 'open')).toBe(true)
    expect(sessions.map((s) => [s.sessionId, s.stepIds])).toEqual([
      ['s-orch', [ORCH]],
      ['s-a', [STEP_A]],
    ])
    // Bất biến gốc của AC-1: không ô nào thuộc về hai node.
    expect(sessions.some((s) => s.stepIds.length > 1)).toBe(false)
  })

  test('TC-02: ghi của nút con KHÔNG đổi sessionId của nút điều phối', () => {
    const T = 'A02'
    seedLedger(T, [entry({ sessionId: 's-orch', stepIds: [ORCH] })])

    record(T, { sessionId: 's-a', stepId: STEP_A })

    const { sessions } = loadTaskSessionLedger(PROJECT, T)
    const orch = sessions.find((s) => s.stepIds.includes(ORCH))
    expect(orch).toMatchObject({ sessionId: 's-orch', status: 'open' })
    expect(orch!.stepIds).toEqual([ORCH])
    expect(sessions).toHaveLength(2)
    expect(sessions[1]).toMatchObject({ sessionId: 's-a', status: 'open' })
    expect(sessions[1].stepIds).toEqual([STEP_A])
  })

  test('TC-03: lượt điều phối đầu tiên ⇒ new, không ăn ké session của step', () => {
    const T = 'A03'
    seedLedger(T, [entry({ sessionId: 's-a', stepIds: [STEP_A] })])

    const p = plan(T, { stepId: ORCH })
    expect(p).toEqual({ sessionMode: 'new', staleReason: 'no open session for this node' })
    expect(JSON.stringify(p)).not.toContain('s-a')
  })

  test('TC-04: cách ly hai chiều — mỗi node resume đúng entry của chính nó', () => {
    const T = 'A04'
    seedLedger(T, [
      entry({ sessionId: 's-orch', stepIds: [ORCH] }),
      entry({ sessionId: 's-a', stepIds: [STEP_A] }),
    ])

    expect(plan(T, { stepId: STEP_A })).toEqual({ sessionMode: 'resume', resumeSessionId: 's-a' })
    // Không phải entry mở MỚI NHẤT (`s-a`) — entry của chính node điều phối.
    expect(plan(T, { stepId: ORCH })).toEqual({ sessionMode: 'resume', resumeSessionId: 's-orch' })
    expect(plan(T, { stepId: 'doc-reviewer' })).toEqual({
      sessionMode: 'new',
      staleReason: 'no open session for this node',
    })
  })

  test('TC-05: forceNew của một node chỉ stale entry của chính node đó', () => {
    const T = 'A05'
    seedLedger(T, [
      entry({ sessionId: 's-a', stepIds: [STEP_A] }),
      entry({ sessionId: 's-b', stepIds: [STEP_B] }),
    ])

    record(T, { sessionId: 's-a2', stepId: STEP_A, forceNew: true })

    const { sessions } = loadTaskSessionLedger(PROJECT, T)
    expect(sessions.find((s) => s.sessionId === 's-a')).toMatchObject({
      status: 'stale',
      staleReason: 'superseded',
    })
    const b = sessions.find((s) => s.sessionId === 's-b')!
    expect(b.status).toBe('open')
    expect(b.staleReason).toBeUndefined()
    expect(sessions.find((s) => s.sessionId === 's-a2')).toMatchObject({ status: 'open' })
    expect(sessions.find((s) => s.sessionId === 's-a2')!.stepIds).toEqual([STEP_A])
  })

  test('TC-06: staleReason không kèm forceNew cũng chỉ chạm node của mình', () => {
    const T = 'A06'
    seedLedger(T, [
      entry({ sessionId: 's-a', stepIds: [STEP_A] }),
      entry({ sessionId: 's-b', stepIds: [STEP_B] }),
    ])

    record(T, { sessionId: 's-a2', stepId: STEP_A, staleReason: 'model changed' })

    const { sessions } = loadTaskSessionLedger(PROJECT, T)
    expect(sessions.find((s) => s.sessionId === 's-a')).toMatchObject({
      status: 'stale',
      staleReason: 'model changed',
    })
    const b = sessions.find((s) => s.sessionId === 's-b')!
    expect(b.status).toBe('open')
    expect(b.staleReason).toBeUndefined()
    expect(b.lastUsedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  test('TC-07: entry lai bị đánh stale lúc đọc', () => {
    const T = 'A07'
    seedLedger(T, [entry({ sessionId: 's-mixed', stepIds: [ORCH, STEP_B] })])

    const { sessions } = loadTaskSessionLedger(PROJECT, T)
    expect(sessions[0]).toMatchObject({ status: 'stale', staleReason: 'mixed-session' })
  })

  test('TC-08: sanitize chỉ sửa trong bộ nhớ, KHÔNG ghi đĩa ở đường đọc', () => {
    const T = 'A08'
    seedLedger(T, [entry({ sessionId: 's-mixed', stepIds: [ORCH, STEP_B] })])
    const file = path.join(home, 'sessions', PROJECT, `${T}.json`)
    const before = fs.readFileSync(file, 'utf8')
    const mtimeBefore = fs.statSync(file).mtimeMs

    loadTaskSessionLedger(PROJECT, T)

    expect(fs.readFileSync(file, 'utf8')).toBe(before)
    expect(fs.statSync(file).mtimeMs).toBe(mtimeBefore)
    expect(rawLedger(T).sessions[0]).toMatchObject({ status: 'open' })
    expect(rawLedger(T).sessions[0].staleReason).toBeUndefined()
  })

  test('TC-09: sanitize được bền hoá ở lần ghi kế tiếp', () => {
    const T = 'A09'
    seedLedger(T, [entry({ sessionId: 's-mixed', stepIds: [ORCH, STEP_B] })])

    record(T, { sessionId: 's-new', stepId: ORCH })

    const raw = rawLedger(T)
    expect(raw.sessions.find((s: any) => s.sessionId === 's-mixed')).toMatchObject({
      status: 'stale',
      staleReason: 'mixed-session',
    })
    const fresh = raw.sessions.find((s: any) => s.sessionId === 's-new')
    expect(fresh).toMatchObject({ status: 'open' })
    expect(fresh.stepIds).toEqual([ORCH])
  })

  test('TC-10: sanitize KHÔNG chạm entry hợp lệ', () => {
    const T = 'A10'
    seedLedger(T, [
      entry({ sessionId: 's1', stepIds: [ORCH] }),
      entry({ sessionId: 's2', stepIds: [STEP_A, STEP_B] }),
      entry({ sessionId: 's3', status: 'stale', staleReason: 'superseded', stepIds: [ORCH, STEP_A] }),
      entry({ sessionId: 's4', stepIds: [] }),
    ])

    const byId = Object.fromEntries(
      loadTaskSessionLedger(PROJECT, T).sessions.map((s) => [s.sessionId, s]),
    )
    for (const id of ['s1', 's2', 's4']) {
      expect(byId[id].status).toBe('open')
      expect(byId[id].staleReason).toBeUndefined()
    }
    // Đã stale sẵn ⇒ giữ nguyên lý do cũ, không bị ghi đè thành 'mixed-session'.
    expect(byId.s3).toMatchObject({ status: 'stale', staleReason: 'superseded' })
  })

  test('TC-11: đường ghi không stepId — không mượn entry của node khác', () => {
    const T = 'A11'
    seedLedger(T, [entry({ sessionId: 's-a', stepIds: [STEP_A] })])

    record(T, { sessionId: 's-adhoc' })

    const { sessions } = loadTaskSessionLedger(PROJECT, T)
    expect(sessions).toHaveLength(2)
    expect(sessions[0]).toMatchObject({ sessionId: 's-a' })
    expect(sessions[0].stepIds).toEqual([STEP_A])
    expect(sessions[1]).toMatchObject({ sessionId: 's-adhoc', status: 'open' })
    expect(sessions[1].stepIds).toEqual([])
  })

  test('TC-12: đường ghi không stepId — tái dùng entry chưa thuộc node nào (nl-chat)', () => {
    const T = 'A12'
    seedLedger(T, [entry({ sessionId: 's-chat', stepIds: [] })])

    record(T, { sessionId: 's-chat2' })

    const { sessions } = loadTaskSessionLedger(PROJECT, T)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ sessionId: 's-chat2', status: 'open' })
    expect(sessions[0].stepIds).toEqual([])
    expect(Date.parse(sessions[0].lastUsedAt)).toBeGreaterThan(Date.parse('2026-01-01T00:00:00.000Z'))
  })

  test('TC-13: đường ghi không stepId nhưng trùng sessionId của entry đã thuộc node', () => {
    const T = 'A13'
    seedLedger(T, [entry({ sessionId: 's-a', stepIds: [STEP_A] })])

    record(T, { sessionId: 's-a' })

    const { sessions } = loadTaskSessionLedger(PROJECT, T)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].stepIds).toEqual([STEP_A])
    expect(Date.parse(sessions[0].lastUsedAt)).toBeGreaterThan(Date.parse('2026-01-01T00:00:00.000Z'))
  })

  test('TC-14: resolveSessionPlan ưu tiên ctx.sessionId hơn entry tìm được', () => {
    const T = 'A14'
    seedLedger(T, [entry({ sessionId: 's-a', stepIds: [STEP_A] })])
    expect(plan(T, { stepId: STEP_A, sessionId: 's-explicit' })).toEqual({
      sessionMode: 'resume',
      resumeSessionId: 's-explicit',
    })
  })

  test('TC-15: ctx.sessionId có nhưng node chưa có entry nào ⇒ vẫn resume', () => {
    const T = 'A15'
    expect(plan(T, { stepId: ORCH, sessionId: 's-explicit' })).toEqual({
      sessionMode: 'resume',
      resumeSessionId: 's-explicit',
    })
  })

  test('TC-16: entry của đúng node nhưng không còn hợp lệ ⇒ new + lý do của check', () => {
    const T = 'A16'
    seedLedger(T, [entry({ sessionId: 's-a', stepIds: [STEP_A] })])

    // `isSessionEntryValid` so: host · status · providerId · connectionId ·
    // workspace · có sessionId chưa. Đổi connection là một trong số đó.
    const p = plan(T, { stepId: STEP_A, connectionId: 'connection-khac' })
    expect(p.sessionMode).toBe('new')
    expect(p.staleReason).toBe('connection changed')
    expect(p.staleReason).not.toBe('no open session for this node')
    expect(p.resumeSessionId).toBeUndefined()

    // Đối chứng: `model` KHÔNG nằm trong tập so sánh — đổi model vẫn resume.
    // Khoá lại hành vi hiện có để lần sau đổi thì phải đổi tường minh.
    expect(plan(T, { stepId: STEP_A, model: 'sonnet' })).toEqual({
      sessionMode: 'resume',
      resumeSessionId: 's-a',
    })
  })

  test('TC-17: entry stale của đúng node không được resume', () => {
    const T = 'A17'
    seedLedger(T, [entry({ sessionId: 's-a', status: 'stale', staleReason: 'superseded', stepIds: [STEP_A] })])
    expect(plan(T, { stepId: STEP_A })).toEqual({
      sessionMode: 'new',
      staleReason: 'no open session for this node',
    })
  })

  test('TC-18: nhiều entry open cùng một node ⇒ lấy entry mới nhất', () => {
    const T = 'A18'
    seedLedger(T, [
      entry({ sessionId: 's-a1', stepIds: [STEP_A] }),
      entry({ sessionId: 's-a2', stepIds: [STEP_A] }),
    ])
    expect(plan(T, { stepId: STEP_A })).toEqual({ sessionMode: 'resume', resumeSessionId: 's-a2' })
  })

  test('TC-19: file ledger cũ thiếu stepIds không làm vỡ đường đọc/ghi', () => {
    const T = 'A19'
    const old: any = { ...META, sessionId: 's-old', status: 'open', createdAt: '2026-01-01T00:00:00.000Z', lastUsedAt: '2026-01-01T00:00:00.000Z' }
    delete old.stepIds
    seedLedger(T, [old])

    // (a) đọc được, entry cũ không bị sanitize nhầm
    expect(loadTaskSessionLedger(PROJECT, T).sessions[0]).toMatchObject({ sessionId: 's-old', status: 'open' })
    // (b) node hỏi phiên của chính nó ⇒ không có
    expect(plan(T, { stepId: ORCH })).toEqual({
      sessionMode: 'new',
      staleReason: 'no open session for this node',
    })
    // (c) đường đọc permissive (không stepId) vẫn nối được
    expect(plan(T)).toEqual({ sessionMode: 'resume', resumeSessionId: 's-old' })

    // (d) ghi của một node không ghi đè entry cũ
    record(T, { sessionId: 's-new', stepId: ORCH })
    const { sessions } = loadTaskSessionLedger(PROJECT, T)
    expect(sessions).toHaveLength(2)
    expect(sessions[0]).toMatchObject({ sessionId: 's-old' })
    expect(sessions[1].stepIds).toEqual([ORCH])
  })

  test('TC-20: sessionPolicy trong file cũ được đọc/ghi nhưng không đổi hành vi', () => {
    const expected = { sessionMode: 'resume', resumeSessionId: 's-a' } as const
    for (const policy of ['per-step', 'per-runner', undefined] as const) {
      const T = `A20-${policy ?? 'none'}`
      seedLedger(T, [entry({ sessionId: 's-a', stepIds: [STEP_A] })], policy ? { sessionPolicy: policy } : {})
      expect(plan(T, { stepId: STEP_A })).toEqual(expected)
    }

    const T = 'A20-per-step'
    record(T, { sessionId: 's-a3', stepId: STEP_A })
    expect(rawLedger(T).sessionPolicy).toBe('per-step')
  })

  // §6.2 của test-spec — bổ sung sau review. Vòng `stale` của
  // `recordSessionUsage` không lọc gì khi `input.stepId` rỗng, nên một job
  // không-step đóng luôn phiên của MỌI node. Đây là lớp cuối cùng còn sót
  // đường quét chéo node (review.md, finding [should] trên sessionLedger.ts).
  test('TC-A-X1: recordSessionUsage không stepId + forceNew không được đóng phiên của node khác', () => {
    const T = 'A-X1'
    seedLedger(T, [
      entry({ sessionId: 's-orch', stepIds: [ORCH] }),
      entry({ sessionId: 's-a', stepIds: [STEP_A] }),
    ])

    record(T, { sessionId: 's-x', forceNew: true })

    const { sessions } = loadTaskSessionLedger(PROJECT, T)
    expect(sessions.find((s) => s.sessionId === 's-orch')!.status).toBe('open')
    expect(sessions.find((s) => s.sessionId === 's-a')!.status).toBe('open')
    const fresh = sessions.find((s) => s.sessionId === 's-x')!
    expect(fresh.status).toBe('open')
    expect(fresh.stepIds).toEqual([])
  })
})

describe('T6427b18c — hồi quy nền dùng chung (TC-R1, TC-R3)', () => {
  // TC-R1 điểm nhạy nhất: đường đọc KHÔNG có stepId phải giữ nguyên hành vi cũ
  // (entry `open` mới nhất), nếu không nl-chat và chat cấp task mở phiên mới
  // mỗi lượt.
  test('TC-R1: resolveSessionPlan không stepId vẫn nối entry open mới nhất', () => {
    const T = 'R01'
    seedLedger(T, [
      entry({ sessionId: 's1', stepIds: [STEP_A] }),
      entry({ sessionId: 's2', stepIds: [] }),
      entry({ sessionId: 's3', stepIds: [ORCH] }),
    ])
    expect(plan(T)).toEqual({ sessionMode: 'resume', resumeSessionId: 's3' })
  })

  test('TC-R3: closeTaskSession có/không stepId', () => {
    const T = 'R03'
    const seed = () =>
      seedLedger(T, [
        entry({ sessionId: 's-orch', stepIds: [ORCH] }),
        entry({ sessionId: 's-a', stepIds: [STEP_A] }),
        entry({ sessionId: 's-b', stepIds: [STEP_B] }),
      ])

    // (a) có stepId ⇒ chỉ node đó bị đóng. `closed`, không phải `stale` — đó là
    // hành vi sẵn có của hàm, case này cố ý khoá lại nguyên trạng.
    seed()
    closeTaskSession(PROJECT, T, { stepId: STEP_A })
    const byId = Object.fromEntries(loadTaskSessionLedger(PROJECT, T).sessions.map((s) => [s.sessionId, s]))
    expect(byId['s-a'].status).toBe('closed')
    expect(byId['s-orch'].status).toBe('open')
    expect(byId['s-b'].status).toBe('open')

    // (b) reset cấp task đóng CẢ phiên điều phối — cố ý giữ.
    seed()
    closeTaskSession(PROJECT, T)
    expect(loadTaskSessionLedger(PROJECT, T).sessions.every((s) => s.status === 'closed')).toBe(true)

    // (c) stepId không tồn tại ⇒ không đổi gì, không throw.
    seed()
    const before = rawLedger(T)
    expect(() => closeTaskSession(PROJECT, T, { stepId: 'khong-ton-tai' })).not.toThrow()
    expect(rawLedger(T)).toEqual(before)
  })
})
