// Tbefa5f4c · Nhóm G (TC-G01 … TC-G21) — `ingestJobToolCalls` / `buildJobToolCallEntry` (F6).
//
// 🔧 Bản 2: bề mặt là `ingestJobToolCalls` (không còn tham số `{useCursor}`),
// `buildJobToolCallEntry`, và hai type `ToolCallEntryPayload` · `BuildToolCallResult`.
//
// Bất biến nền: hàm này KHÔNG BAO GIỜ throw ra caller — `jobQueue` gọi nó
// fire-and-forget. Mọi ca lỗi dưới đây kiểm bằng `.resolves`, không try/catch.
//
// TC-G22 (con trỏ backfill khoá theo `sessionId` + `source`) nằm ở
// `tests/src/features/statistics/business/toolCallStats.test.ts` — con trỏ đó
// sống trong `walkTranscripts`, không trong đường runtime này. Xem test-result.md.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registryHome } from '../../../../src/backend/registry.js'
import {
  resetLogDriver,
  setLogDriver,
  type LogEntry,
  type ToolCallLogEntry,
} from '../../../../src/backend/log/index.js'
import { invalidateLoggingPrefsCache } from '../../../../src/backend/log/loggingPrefsIo.js'
import {
  buildJobToolCallEntry,
  captureJobToolCalls,
  ingestJobToolCalls,
  type BuildToolCallResult,
  type ToolCallEntryPayload,
} from '../../../../src/features/runner/business/toolCallCapture.js'
import { captureJobUsage } from '../../../../src/features/runner/business/usageCapture.js'
import {
  encodeCwdForClaudeProjects,
  subagentsDir,
} from '../../../../src/features/runner/business/claudeUsageTranscript.js'
import {
  getToolCallCursor,
  getUsageCursor,
  loadTaskSessionLedger,
  saveTaskSessionLedger,
  setUsageCursor,
} from '../../../../src/features/runner/business/sessionLedger.js'
import type { JobRecord } from '../../../../src/features/runner/business/types.js'

const PROJECT = 'proj-toolcall'
const TASK = 'T-toolcall'
const SESSION = '22222222-2222-4222-8222-222222222222'
const WORKSPACE = '/tmp/toolcall-ws-capture'

let home: string
let prevHome: string | undefined
let prevHomedir: () => string
let written: LogEntry[] = []

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-toolcall-cap-'))
  prevHome = process.env.DEV_TEAM_DASHBOARD_HOME
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  prevHomedir = os.homedir
  ;(os as { homedir: () => string }).homedir = () => home
})

afterAll(() => {
  ;(os as { homedir: () => string }).homedir = prevHomedir
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

beforeEach(() => {
  for (const sub of ['sessions', 'logs', '.claude', 'agent-sdk-sessions', 'jobs']) {
    fs.rmSync(path.join(home, sub), { recursive: true, force: true })
  }
  try {
    fs.unlinkSync(path.join(home, 'settings.json'))
  } catch {
    /* ignore */
  }
  written = []
  setLogDriver({
    kind: 'file',
    append: async (entry) => {
      written.push(entry)
    },
  })
  writeSettings(true)
})

afterEach(() => {
  resetLogDriver()
  invalidateLoggingPrefsCache()
})

function writeSettings(toolCallEnabled: boolean): void {
  fs.writeFileSync(
    path.join(home, 'settings.json'),
    JSON.stringify({
      logging: {
        showLogsTab: true,
        types: { audit: true, request: true, jobs: true, usage: true, 'tool-call': toolCallEnabled },
      },
    }),
  )
  invalidateLoggingPrefsCache()
}

function job(over: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'j1',
    status: 'succeeded',
    runnerId: 'r1',
    agentRef: 'investigator',
    workspace: WORKSPACE,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    exitCode: 0,
    metadata: { projectId: PROJECT, taskId: TASK, stepId: 'investigate' },
    sessionId: SESSION,
    ...over,
  } as JobRecord
}

/** Ledger phải có entry khớp `sessionId` thì con trỏ mới ghi được. */
function seedLedger(sessionId = SESSION): void {
  const now = new Date().toISOString()
  saveTaskSessionLedger(PROJECT, {
    version: 1,
    taskId: TASK,
    sessionPolicy: 'single',
    sessions: [
      {
        sessionId,
        providerId: 'claude-code-cli',
        runnerId: 'r1',
        connectionId: 'c1',
        workspace: WORKSPACE,
        host: os.hostname(),
        stepIds: [],
        status: 'open',
        createdAt: now,
        lastUsedAt: now,
      },
    ],
  })
}

function assistantRow(name: string, text: string, over: Record<string, unknown> = {}): unknown {
  return {
    type: 'assistant',
    timestamp: '2026-09-30T01:00:00.000Z',
    isSidechain: false,
    message: { content: [{ type: 'tool_use', name, input: { command: text } }] },
    ...over,
  }
}

const FX_CLI: unknown[] = [
  assistantRow('Bash', 'cd /repo && cat request.md'),
  { type: 'user', timestamp: '2026-09-30T01:00:01.000Z', message: { content: [{ type: 'tool_result', content: '...' }] } },
  assistantRow('Grep', 'appendLog'),
  assistantRow('Read', '/repo/src/a.ts', { isSidechain: true }),
]

function transcriptFile(sessionId = SESSION): string {
  const dir = path.join(home, '.claude', 'projects', encodeCwdForClaudeProjects(WORKSPACE))
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `${sessionId}.jsonl`)
}

function writeTranscript(rows: unknown[], sessionId = SESSION): string {
  const file = transcriptFile(sessionId)
  fs.writeFileSync(file, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`)
  return file
}

function writeSdkSession(sessionId: string, calls: Array<[string, string]>): void {
  const dir = path.join(registryHome(), 'agent-sdk-sessions')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${sessionId}.json`),
    JSON.stringify({
      sessionId,
      messages: calls.map(([name, command]) => ({
        role: 'assistant',
        content: [{ type: 'tool_use', name, input: { command } }],
      })),
    }),
  )
}

const toolCallEntries = () =>
  written.filter((e) => e.type === 'tool-call') as ToolCallLogEntry[]

const cursorOf = () => getToolCallCursor(PROJECT, TASK, SESSION)?.mainLines ?? null

describe('Nhóm G — ingestJobToolCalls', () => {
  test('TC-G01: happy path — đúng 1 entry mỗi job, mang đủ định danh', async () => {
    seedLedger()
    writeTranscript(FX_CLI)

    await expect(ingestJobToolCalls(job(), SESSION, 'claude-code-cli')).resolves.toBe(true)

    const entries = toolCallEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      jobId: 'j1',
      taskId: TASK,
      projectId: PROJECT,
      stepId: 'investigate',
      agentRef: 'investigator',
      provider: 'claude-code-cli',
      source: 'cli-transcript',
      callsTotal: 3,
    })
    expect(entries[0].calls).toHaveLength(3)
  })

  test('TC-G02: ⚠️ log type tắt → thoát sớm, con trỏ không đổi (E9)', async () => {
    seedLedger()
    writeTranscript(FX_CLI)
    writeSettings(false)

    await expect(ingestJobToolCalls(job(), SESSION, 'claude-code-cli')).resolves.toBe(false)
    expect(toolCallEntries()).toHaveLength(0)
    // Transcript có 4 dòng đọc được: con trỏ vẫn null nghĩa là adapter chưa hề chạy.
    expect(cursorOf()).toBeNull()
  })

  test('TC-G03: không có sessionId (E4)', async () => {
    writeTranscript(FX_CLI)
    await expect(ingestJobToolCalls(job(), '', 'claude-code-cli')).resolves.toBe(false)
    await expect(
      ingestJobToolCalls(job(), null as unknown as string, 'claude-code-cli'),
    ).resolves.toBe(false)
    expect(toolCallEntries()).toHaveLength(0)
  })

  test('TC-G04: transcript bị prune (E1) → 0 entry, con trỏ KHÔNG được set', async () => {
    seedLedger()
    // Không ghi transcript nào.
    await expect(ingestJobToolCalls(job(), SESSION, 'claude-code-cli')).resolves.toBe(false)
    expect(toolCallEntries()).toHaveLength(0)
    // Con trỏ giữ nguyên để transcript quay lại vẫn đọc được.
    expect(cursorOf()).toBeNull()
  })

  test('TC-G05: không lượt nào mới → không ghi entry rỗng, con trỏ VẪN tiến', async () => {
    seedLedger()
    writeTranscript([
      { type: 'user', timestamp: '2026-09-30T01:00:00.000Z', message: { content: [{ type: 'tool_result', content: 'x' }] } },
      { type: 'user', timestamp: '2026-09-30T01:00:01.000Z', message: { content: [{ type: 'tool_result', content: 'y' }] } },
    ])

    await expect(ingestJobToolCalls(job(), SESSION, 'claude-code-cli')).resolves.toBe(false)
    expect(toolCallEntries()).toHaveLength(0)
    expect(cursorOf()).toBe(2)
  })

  test('TC-G06: ⚠️ idempotent runtime — gọi 2 lần trên file không đổi (E3)', async () => {
    seedLedger()
    writeTranscript(FX_CLI)

    await expect(ingestJobToolCalls(job(), SESSION, 'claude-code-cli')).resolves.toBe(true)
    expect(toolCallEntries()).toHaveLength(1)

    await expect(ingestJobToolCalls(job(), SESSION, 'claude-code-cli')).resolves.toBe(false)
    expect(toolCallEntries()).toHaveLength(1)
  })

  test('TC-G07: job chạy tiếp rồi ingest lại → chỉ phần mới', async () => {
    seedLedger()
    const file = writeTranscript(FX_CLI)
    await ingestJobToolCalls(job(), SESSION, 'claude-code-cli')

    fs.appendFileSync(
      file,
      `${JSON.stringify(assistantRow('Bash', 'ls -la'))}\n${JSON.stringify(assistantRow('Bash', 'pwd'))}\n`,
    )
    await expect(ingestJobToolCalls(job({ id: 'j2' }), SESSION, 'claude-code-cli')).resolves.toBe(true)

    const entries = toolCallEntries()
    expect(entries).toHaveLength(2)
    expect(entries[1].calls).toHaveLength(2)
    expect(entries[1].calls.map((c) => c.text)).toEqual(['ls -la', 'pwd'])
  })

  test('TC-G08: ⚠️ cắt trần số lượt — callsTotal giữ số THẬT (E6)', async () => {
    seedLedger()
    writeTranscript(Array.from({ length: 520 }, (_, i) => assistantRow('Bash', `echo ${i}`)))

    await ingestJobToolCalls(job(), SESSION, 'claude-code-cli')
    const entry = toolCallEntries()[0]
    expect(entry.calls).toHaveLength(500)
    expect(entry.callsTotal).toBe(520)
  })

  test('TC-G09: cắt trần text mỗi lượt', async () => {
    seedLedger()
    writeTranscript([assistantRow('Bash', `echo ${'x'.repeat(5000)}`)])

    await ingestJobToolCalls(job(), SESSION, 'claude-code-cli')
    expect(toolCallEntries()[0].calls[0].text.length).toBeLessThanOrEqual(2048)
  })

  test('TC-G10: trần budget tổng — lượt vượt giữ name/at, mất text, KHÔNG mất phần tử', async () => {
    seedLedger()
    const rows = Array.from({ length: 40 }, (_, i) => assistantRow('Bash', `echo ${'y'.repeat(2000)} ${i}`))
    writeTranscript(rows)

    await ingestJobToolCalls(job(), SESSION, 'claude-code-cli')
    const entry = toolCallEntries()[0]
    expect(entry.calls).toHaveLength(40)
    expect(entry.callsTotal).toBe(40)
    expect(entry.calls.every((c) => c.name === 'Bash')).toBe(true)
    const emptied = entry.calls.filter((c) => c.text === '')
    expect(emptied.length).toBeGreaterThan(0)
    expect(emptied.length).toBeLessThan(40)
    const budgetUsed = entry.calls.reduce((n, c) => n + c.text.length, 0)
    expect(budgetUsed).toBeLessThanOrEqual(65536)
  })

  test('TC-G11: chọn adapter theo provider — adapter còn lại không được gọi', async () => {
    seedLedger()
    // Cùng sessionId có CẢ HAI nguồn: kết quả chỉ khớp một nguồn chứng minh
    // nguồn kia không hề được đọc.
    writeTranscript(FX_CLI)
    writeSdkSession(SESSION, [['Bash', 'ls -la']])

    await ingestJobToolCalls(job(), SESSION, 'claude-code-cli')
    const cli = toolCallEntries()[0]
    expect(cli.source).toBe('cli-transcript')
    expect(cli.calls).toHaveLength(3)
    expect(cli.calls.some((c) => c.text === 'ls -la')).toBe(false)

    written = []
    fs.rmSync(path.join(home, 'sessions'), { recursive: true, force: true })
    seedLedger()
    await ingestJobToolCalls(job({ id: 'j-sdk' }), SESSION, 'openai')
    const sdk = toolCallEntries()[0]
    expect(sdk.source).toBe('agent-sdk-session')
    expect(sdk.calls).toHaveLength(1)
    expect(sdk.calls[0].text).toBe('ls -la')
  })

  test('TC-G12: ⚠️ khử trùng cho nguồn agent-sdk (E14) — callsTotal là số SAU khử trùng', async () => {
    seedLedger()
    writeSdkSession(SESSION, [
      ['Bash', 'ls -la'],
      ['Bash', 'ls -la'],
    ])

    await ingestJobToolCalls(job(), SESSION, 'openai')
    const entry = toolCallEntries()[0]
    expect(entry.calls).toHaveLength(1)
    // §7-Q2: trùng ở đây là ảo ảnh do resume ghi đè file, không phải lượt bị cắt —
    // nên `callsTotal > calls.length` giữ đúng MỘT nghĩa là "đã cắt trần".
    expect(entry.callsTotal).toBe(1)
  })

  test('TC-G13: ⚠️ KHÔNG khử trùng cho nguồn CLI — lặp lệnh thật là dữ liệu', async () => {
    seedLedger()
    writeTranscript([
      assistantRow('Bash', 'ls -la', { timestamp: '2026-09-30T01:00:00.000Z' }),
      assistantRow('Bash', 'ls -la', { timestamp: '2026-09-30T01:05:00.000Z' }),
    ])

    await ingestJobToolCalls(job(), SESSION, 'claude-code-cli')
    const entry = toolCallEntries()[0]
    expect(entry.calls).toHaveLength(2)
    expect(entry.callsTotal).toBe(2)
  })

  test('TC-G14: lỗi trong đường ingest → `captureJobToolCalls` resolve, 0 entry, không throw', async () => {
    seedLedger()
    writeTranscript(FX_CLI)

    // Thay vì mock module (rò sang file test khác trong cùng tiến trình bun),
    // ép lỗi ngay trong đường đọc metadata — cùng hợp đồng quan sát được.
    const broken = job()
    Object.defineProperty(broken, 'metadata', {
      get() {
        throw new Error('boom')
      },
    })

    await expect(captureJobToolCalls(broken, SESSION, 'claude-code-cli')).resolves.toBeUndefined()
    expect(toolCallEntries()).toHaveLength(0)
  })

  test('TC-G15: `appendLog` ném lỗi → hàm vẫn resolve bình thường', async () => {
    seedLedger()
    writeTranscript(FX_CLI)
    setLogDriver({
      kind: 'file',
      append: async () => {
        throw new Error('driver down')
      },
    })

    await expect(ingestJobToolCalls(job(), SESSION, 'claude-code-cli')).resolves.toBe(true)
    await expect(captureJobToolCalls(job(), SESSION, 'claude-code-cli')).resolves.toBeUndefined()
  })

  test('TC-G16: ⚠️ con trỏ tool-call TÁCH khỏi usageCursor', async () => {
    seedLedger()
    writeTranscript(FX_CLI)
    setUsageCursor(PROJECT, TASK, SESSION, { mainLines: 0, subagentFiles: [] })

    await ingestJobToolCalls(job(), SESSION, 'claude-code-cli')
    expect(cursorOf()).toBe(4)
    expect(getUsageCursor(PROJECT, TASK, SESSION)?.mainLines).toBe(0)

    // Và ngược lại: captureJobUsage không làm đổi toolCallCursor.
    const before = cursorOf()
    await captureJobUsage(job({ id: 'j-usage' }), SESSION, 'claude-code-cli')
    expect(cursorOf()).toBe(before)
  })

  test('TC-G17: ⚠️ KHÔNG quét `subagents/` — lượt subagent nhận qua cờ sidechain', async () => {
    seedLedger()
    writeTranscript(FX_CLI) // 3 lượt, 1 cái isSidechain:true

    const dir = subagentsDir(WORKSPACE, SESSION)!
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'sub-1.jsonl'),
      `${Array.from({ length: 5 }, (_, i) => JSON.stringify(assistantRow('Bash', `sub ${i}`))).join('\n')}\n`,
    )

    await ingestJobToolCalls(job(), SESSION, 'claude-code-cli')
    const entry = toolCallEntries()[0]
    expect(entry.callsTotal).toBe(3)
    expect(entry.calls.some((c) => c.text.startsWith('sub '))).toBe(false)
    expect(entry.calls.filter((c) => c.sidechain)).toHaveLength(1)
  })

  test('TC-G18: entry ghi ra đã redact — O1 + O2 của §5.F.0', async () => {
    seedLedger()
    const secret = 'sk-ant-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const command = `curl -H 'Authorization: Bearer ${secret}' http://localhost:3000/api/x`
    writeTranscript([assistantRow('Bash', command)])

    await ingestJobToolCalls(job(), SESSION, 'claude-code-cli')
    const text = toolCallEntries()[0].calls[0].text
    // O1 — secret biến mất.
    expect(text.includes(secret)).toBe(false)
    // O2 — token không phải secret còn nguyên văn.
    const outTokens = text.split(/\s+/).filter(Boolean)
    for (const tok of ['curl', '-H', "'Authorization:", 'http://localhost:3000/api/x']) {
      expect(outTokens).toContain(tok)
    }
  })

  test('TC-G19: 🆕 `buildJobToolCallEntry` không ghi gì và cho kết quả lặp lại được', async () => {
    seedLedger()
    writeTranscript(FX_CLI)

    const a: BuildToolCallResult = await buildJobToolCallEntry(job(), SESSION, 'claude-code-cli', 0)
    const b: BuildToolCallResult = await buildJobToolCallEntry(job(), SESSION, 'claude-code-cli', 0)

    expect(a).toEqual(b)
    expect(a.status).toBe('ok')
    const payload: ToolCallEntryPayload = (a as Extract<BuildToolCallResult, { status: 'ok' }>).payload
    expect(payload.jobId).toBe('j1')
    expect(payload.callsTotal).toBe(3)
    // 🚫 Không ghi log: driver spy nhận 0 lần.
    expect(written).toHaveLength(0)
    // 🚫 Không đụng con trỏ.
    expect(cursorOf()).toBeNull()
  })

  test('TC-G20: 🆕 ⚠️ KHÔNG còn tham số `{useCursor}` — con trỏ luôn được dùng', async () => {
    seedLedger()
    writeTranscript(FX_CLI)

    expect(ingestJobToolCalls.length).toBe(3)
    const legacy = ingestJobToolCalls as unknown as (
      job: JobRecord,
      sessionId: string,
      providerId: string,
      opts: { useCursor: boolean },
    ) => Promise<boolean>

    await expect(legacy(job(), SESSION, 'claude-code-cli', { useCursor: false })).resolves.toBe(true)
    await expect(legacy(job(), SESSION, 'claude-code-cli', { useCursor: false })).resolves.toBe(false)
    expect(toolCallEntries()).toHaveLength(1)
  })

  test('TC-G21: 🆕 ⚠️ `toolCallCursor.mainLines` là SỐ LƯỢT cho nguồn agent-SDK', async () => {
    seedLedger()
    writeSdkSession(SESSION, [
      ['Bash', 'a'],
      ['Bash', 'b'],
      ['Bash', 'c'],
    ])

    await expect(ingestJobToolCalls(job(), SESSION, 'openai')).resolves.toBe(true)
    expect(toolCallEntries()[0].calls).toHaveLength(3)
    expect(cursorOf()).toBe(3)

    // Resume ghi đè nguyên file — 3 lượt cũ + 2 lượt mới.
    writeSdkSession(SESSION, [
      ['Bash', 'a'],
      ['Bash', 'b'],
      ['Bash', 'c'],
      ['Bash', 'd'],
      ['Bash', 'e'],
    ])
    await expect(ingestJobToolCalls(job({ id: 'j2' }), SESSION, 'openai')).resolves.toBe(true)

    const second = toolCallEntries()[1]
    expect(second.calls.map((c) => c.text)).toEqual(['d', 'e'])
    expect(cursorOf()).toBe(5)
  })

  test('ledger giữ đúng một entry sau mọi lượt ingest (không đẻ entry rác)', async () => {
    seedLedger()
    writeTranscript(FX_CLI)
    await ingestJobToolCalls(job(), SESSION, 'claude-code-cli')
    expect(loadTaskSessionLedger(PROJECT, TASK).sessions).toHaveLength(1)
  })
})
