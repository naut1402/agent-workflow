import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  appendLog,
  appendToolCallLog,
  getLogDriver,
  parseLogLine,
  resetLogDriver,
  setLogDriver,
  sqliteLogDriver,
  type LogEntry,
  type ToolCallLogEntry,
} from '../../../../src/backend/log/index.js'
import { logFile } from '../../../../src/backend/log/fileDriver.js'
import { invalidateLoggingPrefsCache } from '../../../../src/backend/log/loggingPrefsIo.js'
import { readLogs } from '../../../../src/features/logs/business/store.js'

afterEach(() => {
  resetLogDriver()
})

describe('core/log driver', () => {
  test('default driver is file-backed (append does not throw)', async () => {
    expect(typeof getLogDriver().append).toBe('function')
    await appendLog({
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
  })

  test('setLogDriver redirects append', async () => {
    const seen: LogEntry[] = []
    setLogDriver({
      append: async (entry) => {
        seen.push(entry)
      },
    })
    await appendLog({
      type: 'audit',
      ts: 2,
      iso: 'y',
      op: 'update',
      entity: 'project',
      identifier: 'p1',
      projectId: 'p1',
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ type: 'audit', entity: 'project' })
  })
})

// ── Tbefa5f4c · Nhóm C (TC-C01 … TC-C08) — gating `appendLog` cho `tool-call` ──
//
// Gate đọc prefs theo khoá gạch nối. Hai lỗi nhóm này gác: ghi khi đã tắt (rò dữ
// liệu phân tích người dùng không bật), và đọc nhầm khoá camelCase (bật nhầm).
describe('Nhóm C — gating appendLog · tool-call', () => {
  let home: string
  let prevHome: string | undefined

  function writeSettings(types: Record<string, unknown>) {
    fs.writeFileSync(
      path.join(home, 'settings.json'),
      JSON.stringify({ logging: { showLogsTab: true, types } }),
    )
    invalidateLoggingPrefsCache()
  }

  /** Payload `tool-call` tối thiểu — `appendLog` nhận entry đã đóng dấu đủ. */
  function toolCallEntry(over: Record<string, unknown> = {}): LogEntry {
    return {
      type: 'tool-call',
      ts: 1_759_276_800_000,
      iso: '2026-09-30T01:00:00.000Z',
      level: 'info',
      traceId: '',
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
        { name: 'Bash', at: null, text: 'cd /r && cat a.md', sidechain: false },
        { name: 'Grep', at: null, text: 'appendLog', sidechain: false },
      ],
      ...over,
    } as LogEntry
  }

  function spyDriver(): LogEntry[] {
    const seen: LogEntry[] = []
    setLogDriver({
      kind: 'file',
      append: async (entry) => {
        seen.push(entry)
      },
    })
    return seen
  }

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-toolcall-gate-'))
    prevHome = process.env.DEV_TEAM_DASHBOARD_HOME
    process.env.DEV_TEAM_DASHBOARD_HOME = home
    invalidateLoggingPrefsCache()
  })

  afterEach(() => {
    resetLogDriver()
    if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
    else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
    invalidateLoggingPrefsCache()
    fs.rmSync(home, { recursive: true, force: true })
  })

  test('TC-C01: ⚠️ tắt → driver KHÔNG nhận lần nào', async () => {
    writeSettings({ 'tool-call': false })
    const seen = spyDriver()
    await appendLog(toolCallEntry())
    expect(seen).toHaveLength(0)
  })

  test('TC-C02: bật → ghi đúng 1 lần, giữ đủ calls', async () => {
    writeSettings({ 'tool-call': true })
    const seen = spyDriver()
    await appendLog(toolCallEntry())
    expect(seen).toHaveLength(1)
    expect(seen[0].type).toBe('tool-call')
    expect((seen[0] as ToolCallLogEntry).calls).toHaveLength(2)
  })

  test('TC-C03: ⚠️ không đụng gate của type khác', async () => {
    writeSettings({ 'tool-call': true, events: false })
    const seen = spyDriver()
    await appendLog(toolCallEntry())
    await appendLog({
      type: 'events',
      ts: 1,
      iso: 'x',
      level: 'info',
      traceId: '',
      event: 'entity.created',
      payload: {},
      projectId: null,
    })
    expect(seen).toHaveLength(1)
    expect(seen[0].type).toBe('tool-call')
  })

  test('TC-C04: ⚠️ gate đọc đúng khoá gạch nối — khoá camelCase KHÔNG bật được', async () => {
    writeSettings({ toolCall: true })
    const seen = spyDriver()
    await appendLog(toolCallEntry())
    expect(seen).toHaveLength(0)
  })

  test('TC-C05: driver file sinh `tool-call.jsonl`, dòng đọc lại parse được', async () => {
    writeSettings({ 'tool-call': true })
    await appendLog(toolCallEntry())
    const file = logFile('tool-call')
    expect(fs.existsSync(file)).toBe(true)
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    const parsed = parseLogLine(lines[0])
    expect(parsed).not.toBeNull()
    expect(parsed!.type).toBe('tool-call')
  })

  test('TC-C06: driver sqlite nhất quán với file (E10)', async () => {
    writeSettings({ 'tool-call': true })

    await appendLog(toolCallEntry({ jobId: 'j-file' }))
    const viaFile = await readLogs({ type: 'tool-call' })

    fs.rmSync(path.join(home, 'logs'), { recursive: true, force: true })
    setLogDriver(sqliteLogDriver)
    await appendLog(toolCallEntry({ jobId: 'j-file' }))
    const viaSqlite = await readLogs({ type: 'tool-call' })

    expect(viaSqlite.length).toBe(viaFile.length)
    expect(viaSqlite.length).toBe(1)
    const a = viaFile[0] as ToolCallLogEntry
    const b = viaSqlite[0] as ToolCallLogEntry
    expect(b.calls).toEqual(a.calls)
    expect(b.callsTotal).toBe(a.callsTotal)
  })

  test('TC-C07: `appendToolCallLog` là đường ghi duy nhất, có traceId trên entry', async () => {
    writeSettings({ 'tool-call': true })
    const seen = spyDriver()
    const { type: _t, ts: _ts, iso: _iso, level: _l, traceId: _tr, ...payload } =
      toolCallEntry() as any
    await appendToolCallLog(payload)
    expect(seen).toHaveLength(1)
    const entry = seen[0] as ToolCallLogEntry
    expect(entry.calls).toHaveLength(2)
    expect(typeof entry.traceId).toBe('string')
  })

  test('TC-C08: 🆕 ⚠️ `ts` tuỳ chọn — truyền thì DÙNG, không truyền thì now()', async () => {
    writeSettings({ 'tool-call': true })
    const seen = spyDriver()
    const { type: _t, ts: _ts, iso: _iso, level: _l, traceId: _tr, ...payload } =
      toolCallEntry() as any

    // (a) ts truyền vào KHÔNG được ghi đè bằng now() — đây là thứ làm
    // `coverage.firstTs/lastTs` có nghĩa với dữ liệu backfill (xem TC-M15).
    await appendToolCallLog({ ...payload, ts: 1_759_276_800_000 })
    expect(seen[0].ts).toBe(1_759_276_800_000)
    expect(seen[0].iso).toBe(new Date(1_759_276_800_000).toISOString())

    // (b) không truyền → kẹp giữa hai mốc đọc trong test.
    const before = Date.now()
    await appendToolCallLog(payload)
    const after = Date.now()
    expect(seen).toHaveLength(2)
    expect(seen[1].ts).toBeGreaterThanOrEqual(before)
    expect(seen[1].ts).toBeLessThanOrEqual(after)
    expect(seen[1].ts).not.toBe(1_759_276_800_000)
  })
})
