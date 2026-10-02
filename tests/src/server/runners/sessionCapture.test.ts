import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildClaudeInvocation } from '../../../../src/features/runner/business/providers/claude-code-cli.js'
import {
  buildCursorJsonArgs,
  buildCursorJsonInvocation,
  getUsageCursor,
  mintSessionId,
  parseCursorJsonOutput,
  prepareSessionInvocation,
  saveTaskSessionLedger,
  setUsageCursor,
  type SessionEntry,
} from '../../../../src/features/runner/business/sessionLedger.js'

describe('sessionCapture', () => {
  test('claude preset-uuid: mints id when starting fresh', () => {
    const plan = prepareSessionInvocation({ capture: 'preset-uuid' })
    expect(plan.sessionId).toBeTruthy()
    expect(plan.presetSessionId).toBe(plan.sessionId)
    expect(plan.resumeSessionId).toBeUndefined()

    const inv = buildClaudeInvocation({
      flags: [],
      prompt: 'hello',
      sessionId: plan.sessionId,
    })
    expect(inv.args).toContain('--session-id')
    expect(inv.args).toContain(plan.sessionId)
  })

  test('claude preset-uuid: uses provided sessionId for approval thread', () => {
    const fixed = mintSessionId()
    const plan = prepareSessionInvocation({ capture: 'preset-uuid', sessionId: fixed })
    expect(plan.sessionId).toBe(fixed)
    expect(plan.presetSessionId).toBe(fixed)
  })

  test('claude resume passes --resume only', () => {
    const plan = prepareSessionInvocation({
      capture: 'preset-uuid',
      resumeSessionId: 'resume-abc',
    })
    expect(plan.resumeSessionId).toBe('resume-abc')
    expect(plan.sessionId).toBeUndefined()

    const inv = buildClaudeInvocation({
      flags: [],
      prompt: 'follow up',
      resumeSessionId: plan.resumeSessionId,
    })
    expect(inv.args).toEqual(['-p', '--resume', 'resume-abc'])
  })

  test('cursor parse-json: buildCursorJsonArgs adds -p, json, sandbox disabled, force, trust (prompt NOT in argv)', () => {
    const args = buildCursorJsonArgs(['--model', 'x'], 'do task')
    expect(args).toContain('-p')
    expect(args).toContain('--output-format')
    expect(args).toContain('json')
    expect(args).toContain('--sandbox')
    expect(args).toContain('disabled')
    expect(args).toContain('--force')
    expect(args).toContain('--trust')
    // Regression (#177): prompt must never be an argv element — Windows
    // shell:true space-joins argv and cmd.exe would truncate a multi-line
    // prompt to the first token ("##").
    expect(args).not.toContain('do task')
  })

  test('cursor parse-json: buildCursorJsonInvocation puts prompt on stdin and --resume in argv', () => {
    const inv = buildCursorJsonInvocation({
      flags: ['--model', 'x'],
      prompt: '## Agent instructions\n\nfull multi-line prompt',
      resumeSessionId: 'sess-abc',
    })
    expect(inv.stdinInput).toBe('## Agent instructions\n\nfull multi-line prompt')
    expect(inv.args).toEqual([
      '--model',
      'x',
      '-p',
      '--output-format',
      'json',
      '--sandbox',
      'disabled',
      '--force',
      '--trust',
      '--resume',
      'sess-abc',
    ])
    for (const arg of inv.args) {
      expect(arg.includes('Agent instructions')).toBe(false)
    }
  })

  test('cursor parse-json: does not duplicate --trust / --force / --sandbox when already set', () => {
    const args = buildCursorJsonArgs(['--trust', '--force', '--sandbox', 'enabled', '-p'], 'do task')
    expect(args.filter((f) => f === '--trust')).toHaveLength(1)
    expect(args.filter((f) => f === '--force')).toHaveLength(1)
    expect(args.filter((f) => f === '--sandbox')).toHaveLength(1)
    expect(args).toContain('enabled')
    expect(args).not.toContain('disabled')
  })

  test('cursor parse-json: --yolo / -f count as force (no duplicate --force)', () => {
    expect(buildCursorJsonArgs(['--yolo'], 'x')).toContain('--yolo')
    expect(buildCursorJsonArgs(['--yolo'], 'x')).not.toContain('--force')
    expect(buildCursorJsonArgs(['-f'], 'x')).toContain('-f')
    expect(buildCursorJsonArgs(['-f'], 'x')).not.toContain('--force')
    expect(buildCursorJsonArgs(['--force'], 'x').filter((f) => f === '--force')).toHaveLength(1)
  })

  test('parseCursorJsonOutput extracts session_id and result', () => {
    const stdout = JSON.stringify({
      session_id: 'chat-99',
      result: 'proposed markdown body',
      other: true,
    })
    expect(parseCursorJsonOutput(stdout)).toEqual({
      session_id: 'chat-99',
      result: 'proposed markdown body',
    })
  })

  test('parseCursorJsonOutput extracts usage (camelCase) from Cursor result JSON', () => {
    const stdout = JSON.stringify({
      type: 'result',
      subtype: 'success',
      session_id: '10bc53f4-fcf9-489c-a300-a8d611e7df9c',
      result: 'Xin chào!',
      usage: {
        inputTokens: 12144,
        outputTokens: 388,
        cacheReadTokens: 5952,
        cacheWriteTokens: 0,
      },
    })
    expect(parseCursorJsonOutput(stdout)).toEqual({
      session_id: '10bc53f4-fcf9-489c-a300-a8d611e7df9c',
      result: 'Xin chào!',
      usage: {
        inputTokens: 12144,
        outputTokens: 388,
        cacheReadTokens: 5952,
        cacheWriteTokens: 0,
      },
    })
  })

  test('parseCursorJsonOutput tolerates leading noise before JSON object', () => {
    const body = JSON.stringify({
      session_id: 'chat-noise',
      result: '===DRAFT_READY===\n```json\n{"taskId":"t1"}\n```',
    })
    const stdout = `cursor-retrieval: tracing to 'C:\\Temp\\x.log'\n${body}\n`
    expect(parseCursorJsonOutput(stdout)).toEqual({
      session_id: 'chat-noise',
      result: '===DRAFT_READY===\n```json\n{"taskId":"t1"}\n```',
    })
  })

  test('parseCursorJsonOutput tolerates invalid JSON', () => {
    expect(parseCursorJsonOutput('not json')).toEqual({})
    expect(parseCursorJsonOutput('')).toEqual({})
  })

  test('none capture passes session fields through unchanged', () => {
    expect(
      prepareSessionInvocation({
        capture: 'none',
        sessionId: 'a',
        resumeSessionId: 'b',
      }),
    ).toEqual({ sessionId: 'a', resumeSessionId: 'b' })
  })
})

/*
 * T6427b18c TC-R4 — cursor tìm đúng entry khi ledger có NHIỀU entry.
 *
 * Cách ly phiên theo node làm số entry trong một file ledger tăng hẳn (tối đa
 * một `open` cho mỗi node, cộng các entry `stale` cũ). `usageCursor` tra theo
 * `sessionId`, nên phải chứng minh nó không lây sang entry hàng xóm.
 *
 * Nửa `toolCallCursor` của TC-R4 hiện KHÔNG chạy được — xem case (c) bên dưới.
 */
describe('cursor theo sessionId trên ledger nhiều entry (TC-R4)', () => {
  const PROJECT = 'P-cursor'
  const TASK = 'CUR-1'
  let home: string
  const savedHome = process.env.DEV_TEAM_DASHBOARD_HOME

  function entry(over: Partial<SessionEntry> & { sessionId: string }): SessionEntry {
    return {
      providerId: 'claude-code-cli',
      runnerId: 'r1',
      connectionId: 'c1',
      workspace: '/tmp/ws',
      host: os.hostname(),
      stepIds: [],
      status: 'stale',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: '2026-01-01T00:00:00.000Z',
      ...over,
    }
  }

  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-cursor-'))
    process.env.DEV_TEAM_DASHBOARD_HOME = home
    saveTaskSessionLedger(PROJECT, {
      version: 1,
      taskId: TASK,
      sessionPolicy: 'single',
      sessions: [
        entry({ sessionId: 's-old1' }),
        entry({ sessionId: 's-old2', usageCursor: { mainLines: 99, subagentFiles: ['x.jsonl'] } }),
        entry({ sessionId: 's-orch', status: 'open', stepIds: ['__orchestrator__'], usageCursor: { mainLines: 7, subagentFiles: [] } }),
        entry({ sessionId: 's-old3' }),
        entry({ sessionId: 's-a', status: 'open', stepIds: ['investigator'] }),
      ],
    })
  })
  afterAll(() => {
    if (savedHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
    else process.env.DEV_TEAM_DASHBOARD_HOME = savedHome
    fs.rmSync(home, { recursive: true, force: true })
  })

  test('(a) ghi rồi đọc cursor của s-a trả đúng giá trị vừa ghi', () => {
    setUsageCursor(PROJECT, TASK, 's-a', { mainLines: 42, subagentFiles: [] })
    expect(getUsageCursor(PROJECT, TASK, 's-a')).toEqual({ mainLines: 42, subagentFiles: [] })
  })

  test('(b) cursor của phiên điều phối KHÔNG bị lây giá trị của s-a', () => {
    expect(getUsageCursor(PROJECT, TASK, 's-orch')).toEqual({ mainLines: 7, subagentFiles: [] })
    expect(getUsageCursor(PROJECT, TASK, 's-old2')).toEqual({ mainLines: 99, subagentFiles: ['x.jsonl'] })
  })

  // SKIP: `getToolCallCursor`/`setToolCallCursor` không tồn tại ở BẤT KỲ ref nào
  // (branch test, `05bfa9e`, `dev/1.2.0/main`) — cả cụm tool-call capture đã bị gỡ
  // khỏi `sessionLedger`, trong khi `test-spec.md` §1.1 vẫn kê nó ở `sessionCapture`:
  // spec và code lệch nhau ở đây, không phải test sai. 🚫 Không stub một hàm không
  // tồn tại để test xanh. Khôi phục case này khi API có thật; nó phải assert
  // `toolCallCursor` trỏ đúng entry theo `sessionId` và KHÔNG đụng `usageCursor`
  // của cùng entry (hai khoá cố ý tách rời).
  test.skip('(c) toolCallCursor trỏ đúng entry, tách hẳn khỏi usageCursor', () => {})

  test('sessionId không có trong ledger ⇒ null, không throw', () => {
    expect(getUsageCursor(PROJECT, TASK, 'khong-ton-tai')).toBeNull()
  })
})
