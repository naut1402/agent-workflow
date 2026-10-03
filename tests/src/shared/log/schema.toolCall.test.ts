// Tbefa5f4c · Nhóm A (TC-A01 … TC-A08) — `parseLogLine` với log type `tool-call`.
//
// Hai thứ nhóm này gác, và không suite nào khác gác được:
//   - entry `tool-call` phải parse ra ĐÚNG như schema khai (kể cả nullable),
//   - việc thêm một type mới KHÔNG được làm vỡ 5 type cũ (TC-A05) và tên type
//     phải là chuỗi gạch nối `tool-call`, không phải `toolCall` (TC-A06/A07).
import { describe, expect, test } from 'vitest'
import {
  LOG_TYPES,
  TOOL_CALL_MAX_CALLS,
  TOOL_CALL_TEXT_BUDGET,
  TOOL_CALL_TEXT_MAX_CHARS,
  parseLogLine,
  type ToolCallLogEntry,
} from '@/shared/log/schema'

/** Entry `tool-call` tối thiểu hợp lệ — ca nào cần lệch thì ghi đè khoá. */
function toolCallLine(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'tool-call',
    ts: 1_759_276_800_000,
    iso: '2026-09-30T01:00:00.000Z',
    level: 'info',
    traceId: 'tr-1',
    jobId: 'j1',
    sessionId: 's1',
    taskId: 'T1',
    projectId: 'p1',
    stepId: 'implement',
    agentRef: 'implementer',
    provider: 'claude-code-cli',
    source: 'cli-transcript',
    callsTotal: 2,
    calls: [
      { name: 'Bash', at: '2026-09-30T01:00:00.000Z', text: 'cd /r &&\ncat a.md', sidechain: false },
      { name: 'Grep', at: null, text: 'appendLog', sidechain: true },
    ],
    ...over,
  })
}

describe('Nhóm A — parseLogLine · tool-call', () => {
  test('TC-A01: entry hợp lệ parse ra, giữ nguyên newline trong calls[].text', () => {
    const entry = parseLogLine(toolCallLine())
    expect(entry).not.toBeNull()
    expect(entry!.type).toBe('tool-call')
    const e = entry as ToolCallLogEntry
    expect(e.calls.length).toBe(2)
    // Xuống dòng là dữ liệu: phân tích ý định cần cả chuỗi `&&` lẫn thân heredoc.
    expect(e.calls[0].text).toBe('cd /r &&\ncat a.md')
    expect(e.calls[0].text).toContain('\n')
    expect(e.callsTotal).toBe(2)
  })

  test('TC-A02: thiếu `calls` → null', () => {
    const raw = JSON.parse(toolCallLine()) as Record<string, unknown>
    delete raw.calls
    expect(parseLogLine(JSON.stringify(raw))).toBeNull()
  })

  test('TC-A03: phần tử `calls` thiếu `name` → null', () => {
    expect(parseLogLine(toolCallLine({ calls: [{ at: null, text: 'x', sidechain: false }] }))).toBeNull()
  })

  test('TC-A04: trường nullable nhận null và GIỮ null', () => {
    const entry = parseLogLine(
      toolCallLine({
        sessionId: null,
        taskId: null,
        projectId: null,
        stepId: null,
        agentRef: null,
        callsTotal: 1,
        calls: [{ name: 'Bash', at: null, text: 'ls', sidechain: false }],
      }),
    )
    expect(entry).not.toBeNull()
    const e = entry as ToolCallLogEntry
    expect(e.sessionId).toBeNull()
    expect(e.taskId).toBeNull()
    expect(e.projectId).toBeNull()
    expect(e.stepId).toBeNull()
    expect(e.agentRef).toBeNull()
    expect(e.calls[0].at).toBeNull()
    // Không được âm thầm đổi thành undefined / chuỗi rỗng.
    expect(e.sessionId).not.toBe(undefined)
    expect(e.sessionId).not.toBe('')
  })

  test('TC-A05: ⚠️ hồi quy — 5 type cũ vẫn parse ra sau khi thêm type mới', () => {
    const request = JSON.stringify({
      type: 'request',
      ts: 1,
      iso: 'x',
      method: 'GET',
      path: '/ping',
      projectId: null,
      status: 200,
      durationMs: 0,
      error: null,
    })
    const audit = JSON.stringify({
      type: 'audit',
      ts: 2,
      iso: 'y',
      op: 'update',
      entity: 'project',
      identifier: 'p1',
      projectId: 'p1',
    })
    const usage = JSON.stringify({
      type: 'usage',
      ts: 3,
      iso: 'z',
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      estimatedCostUsd: null,
      model: null,
      provider: 'claude-code-cli',
      jobId: 'job-1',
    })
    const events = JSON.stringify({
      type: 'events',
      ts: 4,
      iso: 'w',
      event: 'entity.created',
      payload: { id: 'p1' },
      projectId: 'p1',
    })

    for (const line of [request, audit, usage, events]) {
      expect(parseLogLine(line)).not.toBeNull()
    }
    // `jobs` là log type của prefs nhưng KHÔNG phải một discriminant của LogEntry —
    // khẳng định đúng điều đó thay vì khẳng định nó parse ra.
    expect(LOG_TYPES as readonly string[]).not.toContain('jobs')
  })

  test('TC-A06: ⚠️ tên type là chuỗi gạch nối', () => {
    expect(LOG_TYPES as readonly string[]).toContain('tool-call')
    expect(LOG_TYPES as readonly string[]).not.toContain('toolCall')
  })

  test('TC-A07: type lạ `toolCall` vẫn bị loại dù payload đúng mọi thứ khác', () => {
    expect(parseLogLine(toolCallLine({ type: 'toolCall' }))).toBeNull()
  })

  test('TC-A08: ba hằng trần khai đúng giá trị và export từ shared/log/schema', () => {
    expect(TOOL_CALL_MAX_CALLS).toBe(500)
    expect(TOOL_CALL_TEXT_MAX_CHARS).toBe(2048)
    expect(TOOL_CALL_TEXT_BUDGET).toBe(65536)
  })
})
