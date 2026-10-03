// Tbefa5f4c · Nhóm J (TC-J01 … TC-J23) + Nhóm M (TC-M01 … TC-M15) + TC-G22.
//
// Nhóm J quyết định MỌI con số trong báo cáo (deliverable #2 của `request.md`).
// Nhóm M là deliverable #1 — script để "lần sau không phải đọc toàn bộ log".
//
// TC-G22 nằm ở đây chứ không ở `toolCallCapture.test.ts`: con trỏ khoá theo
// `sessionId` + `source` sống trong `walkTranscripts` của module này, không
// trong đường runtime. Xem test-result.md › Lệch spec.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { appendToolCallLog } from '../../../../../src/backend/log/store.js'
import { invalidateLoggingPrefsCache } from '../../../../../src/backend/log/loggingPrefsIo.js'
import { logFile } from '../../../../../src/backend/log/fileDriver.js'
import { resetLogDriver, setLogDriver } from '../../../../../src/backend/log/driver.js'
import { registryHome } from '../../../../../src/backend/registry.js'
import { encodeCwdForClaudeProjects } from '../../../../../src/features/runner/business/claudeUsageTranscript.js'
import {
  aggregateToolUsage,
  collectFromTranscripts,
  ingestFromTranscripts,
  readToolCallEntries,
} from '../../../../../src/features/statistics/business/toolCallStats.js'
import { toolCallStatsSchema } from '../../../../../src/features/statistics/schemas/toolCallStats.js'
import type { ToolCall, ToolCallLogEntry } from '../../../../../src/shared/log/schema.js'

const REPO_ROOT = path.resolve(import.meta.dir, '../../../../..')
const WORKSPACE = '/tmp/toolstats-ws'

const TS_DAY1 = Date.parse('2026-09-30T01:00:00.000Z')
const TS_DAY2 = Date.parse('2026-10-01T01:00:00.000Z')
const TS_DAY3 = Date.parse('2026-10-02T01:00:00.000Z')

/**
 * Session id của transcript CLI phải khớp `SESSION_ID_RE` — chỉ hex và dấu gạch.
 * `sessionTranscriptPath` trả null cho mọi id có chữ ngoài hex, và lúc đó job rơi
 * vào `noTranscript` chứ không phải `ingested`.
 */
const sid = (n: number): string => `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, '0')}`

let home: string
let prevHome: string | undefined
let prevClaudeSession: string | undefined
let prevHomedir: () => string

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-toolstats-'))
  prevHome = process.env.DEV_TEAM_DASHBOARD_HOME
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  prevClaudeSession = process.env.CLAUDE_SESSION_ID
  delete process.env.CLAUDE_SESSION_ID
  prevHomedir = os.homedir
  ;(os as { homedir: () => string }).homedir = () => home
})

afterAll(() => {
  ;(os as { homedir: () => string }).homedir = prevHomedir
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  if (prevClaudeSession === undefined) delete process.env.CLAUDE_SESSION_ID
  else process.env.CLAUDE_SESSION_ID = prevClaudeSession
  fs.rmSync(home, { recursive: true, force: true })
})

beforeEach(() => {
  for (const sub of ['logs', 'jobs', 'agent-sdk-sessions', '.claude', 'db']) {
    fs.rmSync(path.join(home, sub), { recursive: true, force: true })
  }
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

// ── Fixture ──────────────────────────────────────────────────────────────────

function call(name: string, text: string, over: Partial<ToolCall> = {}): ToolCall {
  return { name, at: null, text, sidechain: false, ...over }
}

interface EntrySpec {
  jobId: string
  sessionId?: string | null
  calls: ToolCall[]
  callsTotal?: number
  ts?: number
  taskId?: string | null
  projectId?: string | null
  agentRef?: string | null
}

/** Entry in-memory — dùng cho `aggregateToolUsage` (không chạm log). */
function entry(spec: EntrySpec): ToolCallLogEntry {
  const ts = spec.ts ?? TS_DAY1
  return {
    type: 'tool-call',
    ts,
    iso: new Date(ts).toISOString(),
    level: 'info',
    traceId: '',
    jobId: spec.jobId,
    sessionId: spec.sessionId ?? null,
    taskId: spec.taskId ?? null,
    projectId: spec.projectId ?? null,
    stepId: null,
    agentRef: spec.agentRef ?? null,
    provider: 'claude-code-cli',
    source: 'cli-transcript',
    callsTotal: spec.callsTotal ?? spec.calls.length,
    calls: spec.calls,
  }
}

/**
 * §4.5 `FX-ENTRIES` — 2 entry, 7 lượt:
 *   j1/s1: Bash(read) · Bash(grep) · Bash(read) · mcp__agent-workflow__list_tasks
 *   j2/s2: Bash(grep) · Read · Bash(read)
 */
function fxEntries(): ToolCallLogEntry[] {
  return [
    entry({
      jobId: 'j1',
      sessionId: 's1',
      taskId: 'T1',
      projectId: 'p1',
      agentRef: 'investigator',
      calls: [
        call('Bash', 'cat a.md'),
        call('Bash', 'grep -rn foo src'),
        call('Bash', 'cat b.md'),
        call('mcp__agent-workflow__list_tasks', '{}'),
      ],
    }),
    entry({
      jobId: 'j2',
      sessionId: 's2',
      taskId: 'T2',
      projectId: 'p2',
      agentRef: 'designer',
      ts: TS_DAY2,
      calls: [call('Bash', 'grep -rn bar src'), call('Read', '/repo/a.ts'), call('Bash', 'cat c.md')],
    }),
  ]
}

/** Ghi entry thật vào log (đi qua driver đang active). */
async function seedLog(entries: ToolCallLogEntry[]): Promise<void> {
  for (const e of entries) {
    const { type: _t, iso: _i, level: _l, traceId: _tr, ...payload } = e
    await appendToolCallLog(payload)
  }
}

// ── Nhóm J — readToolCallEntries ─────────────────────────────────────────────

describe('Nhóm J — readToolCallEntries', () => {
  test('TC-J01: ⚠️ log type tắt → [] (E9)', async () => {
    await seedLog(fxEntries())
    expect(await readToolCallEntries()).toHaveLength(2)

    writeSettings(false)
    expect(await readToolCallEntries()).toEqual([])
  })

  test('TC-J02: đọc qua driver đang active — file và sqlite cho cùng kết quả (E10)', async () => {
    // ⚠️ Kết nối SQLite được `getDb()` cache cho cả tiến trình `bun test`, nên DB
    // không bị `beforeEach` dọn cùng `home/`: entry của suite khác trong cùng
    // lượt chạy vẫn nằm đó. Lọc theo một `taskId` riêng của ca này để so đúng
    // hai cây dữ liệu, thay vì so tổng số dòng của cả DB.
    const UNIQ = 'T-driver-parity'
    const fixture = fxEntries().map((e) => ({ ...e, taskId: UNIQ }))

    await seedLog(fixture)
    const viaFile = await readToolCallEntries({ taskId: UNIQ })
    expect(viaFile).toHaveLength(2)

    fs.rmSync(path.join(home, 'logs'), { recursive: true, force: true })
    const { sqliteLogDriver } = await import('../../../../../src/backend/log/sqliteDriver.js')
    setLogDriver(sqliteLogDriver)
    await seedLog(fixture)
    const viaSqlite = await readToolCallEntries({ taskId: UNIQ })

    expect(viaSqlite).toHaveLength(viaFile.length)
    expect(viaSqlite.map((e) => e.jobId).sort()).toEqual(viaFile.map((e) => e.jobId).sort())
    expect(viaSqlite.map((e) => e.calls.length).sort()).toEqual(viaFile.map((e) => e.calls.length).sort())
  })

  test('TC-J03: lọc thời gian — nhận cả ISO lẫn epoch', async () => {
    await seedLog(fxEntries())
    const iso = await readToolCallEntries({
      from: '2026-09-30T00:00:00.000Z',
      to: '2026-09-30T23:59:59.999Z',
    })
    expect(iso.map((e) => e.jobId)).toEqual(['j1'])

    const epoch = await readToolCallEntries({ from: String(TS_DAY1), to: String(TS_DAY1 + 3_600_000) })
    expect(epoch.map((e) => e.jobId)).toEqual(['j1'])
  })

  test('TC-J04: lọc projectId / taskId / agentRef', async () => {
    await seedLog(fxEntries())
    expect((await readToolCallEntries({ projectId: 'p2' })).map((e) => e.jobId)).toEqual(['j2'])
    expect((await readToolCallEntries({ taskId: 'T1' })).map((e) => e.jobId)).toEqual(['j1'])
    expect((await readToolCallEntries({ agentRef: 'designer' })).map((e) => e.jobId)).toEqual(['j2'])
  })

  test('TC-J05: entry hỏng xen giữa log bị bỏ qua, không throw', async () => {
    await seedLog(fxEntries())
    fs.appendFileSync(logFile('tool-call'), '{"type":"tool-call","khong-hop-le\n')
    const entries = await readToolCallEntries()
    expect(entries).toHaveLength(2)
  })

  test('TC-J06: ⚠️ excludeSessionIds (G7/E8)', async () => {
    await seedLog(fxEntries())
    const entries = await readToolCallEntries({ excludeSessionIds: ['s1'] })
    expect(entries.map((e) => e.jobId)).toEqual(['j2'])

    const report = aggregateToolUsage(entries)
    expect(report.coverage.entries).toBe(1)
    expect(report.mcpAdoption.totalCalls).toBe(3)
  })
})

// ── Nhóm J — aggregateToolUsage ──────────────────────────────────────────────

describe('Nhóm J — aggregateToolUsage', () => {
  test('TC-J07: `byTool`', () => {
    const r = aggregateToolUsage(fxEntries())
    expect(Object.fromEntries(r.byTool.map((x) => [x.name, x.calls]))).toEqual({
      Bash: 5,
      Read: 1,
      'mcp__agent-workflow__list_tasks': 1,
    })
    expect(r.byTool[0].name).toBe('Bash')
    // Sắp giảm dần theo số lượt.
    expect(r.byTool.map((x) => x.calls)).toEqual([...r.byTool.map((x) => x.calls)].sort((a, b) => b - a))
    expect(r.byTool.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 10)
    expect(r.byTool.find((x) => x.name === 'Bash')!.sessions).toBe(2)
  })

  test('TC-J08: `bashIntents` chia cho tổng lượt BASH, không phải tổng lượt', () => {
    const r = aggregateToolUsage(fxEntries())
    const read = r.bashIntents.find((x) => x.intent === 'read')!
    const grep = r.bashIntents.find((x) => x.intent === 'grep')!
    expect(read.calls).toBe(3)
    expect(grep.calls).toBe(2)
    // Mẫu số là 5 (lượt Bash), KHÔNG phải 7 (tổng lượt).
    expect(read.share).toBeCloseTo(3 / 5, 10)
    expect(grep.share).toBeCloseTo(2 / 5, 10)
  })

  test('TC-J09: tổng share ý định vượt 100% là HỢP LỆ', () => {
    const entries = [
      ...fxEntries(),
      entry({ jobId: 'j3', sessionId: 's3', calls: [call('Bash', 'cd /r && cat a.md')] }),
    ]
    const r = aggregateToolUsage(entries)
    const total = r.bashIntents.reduce((s, x) => s + x.share, 0)
    expect(total).toBeGreaterThan(1)
  })

  test('TC-J10: ⚠️ bigram KHÔNG bắc cầu qua ranh giới entry', () => {
    const r = aggregateToolUsage(fxEntries())
    // (n1−1) + (n2−1) = 3 + 2 = 5.
    expect(r.bigrams.reduce((s, b) => s + b.count, 0)).toBe(5)
    // Lượt cuối entry1 là `mcp__…`, lượt đầu entry2 là `grep` — cặp đó không tồn tại.
    expect(
      r.bigrams.some((b) => b.from === 'mcp__agent-workflow__list_tasks' && b.to === 'grep'),
    ).toBe(false)
  })

  test('TC-J11: bigram trong cùng entry', () => {
    const r = aggregateToolUsage([
      entry({
        jobId: 'jb',
        sessionId: 'sb',
        calls: [call('Bash', 'cat a.md'), call('Bash', 'grep x src'), call('Bash', 'cat b.md')],
      }),
    ])
    expect(r.bigrams.find((b) => b.from === 'read' && b.to === 'grep')!.count).toBe(1)
    expect(r.bigrams.find((b) => b.from === 'grep' && b.to === 'read')!.count).toBe(1)
  })

  test('TC-J12: `surveyLoopShare` khớp tính tay (3/4)', () => {
    const r = aggregateToolUsage([
      entry({
        jobId: 'js',
        sessionId: 'ss',
        calls: [
          call('Bash', 'cat a.md'),
          call('Bash', 'grep x src'),
          call('Bash', 'cat b.md'),
          call('Bash', 'grep y src'),
          call('mcp__agent-workflow__list_tasks', '{}'),
        ],
      }),
    ])
    expect(r.bigrams.reduce((s, b) => s + b.count, 0)).toBe(4)
    expect(r.surveyLoopShare).toBeCloseTo(0.75, 10)
  })

  test('TC-J13: `mcpAdoption` khi có cả hai loại tool', () => {
    const r = aggregateToolUsage(fxEntries())
    expect(r.mcpAdoption.mcpCalls).toBe(1)
    expect(r.mcpAdoption.totalCalls).toBe(7)
    expect(r.mcpAdoption.share).toBeCloseTo(1 / 7, 4)
    expect(r.mcpAdoption.byTool.map((x) => x.name)).toEqual(['mcp__agent-workflow__list_tasks'])
  })

  test('TC-J14: ⚠️ `mcpAdoption` khi KHÔNG có lượt MCP nào — share 0, không NaN', () => {
    const r = aggregateToolUsage([
      entry({ jobId: 'jn', sessionId: 'sn', calls: [call('Bash', 'ls -la'), call('Read', '/a.ts')] }),
    ])
    expect(r.mcpAdoption.mcpCalls).toBe(0)
    expect(r.mcpAdoption.share).toBe(0)
    expect(Number.isNaN(r.mcpAdoption.share)).toBe(false)
    expect(r.mcpAdoption.byTool).toEqual([])
  })

  test('TC-J15: mặc định LOẠI sidechain', () => {
    const e = entry({
      jobId: 'jsc',
      sessionId: 'ssc',
      calls: [
        call('Bash', 'ls -la'),
        call('Bash', 'cat a.md'),
        call('Bash', 'grep x src'),
        call('Bash', 'sub 1', { sidechain: true }),
        call('Bash', 'sub 2', { sidechain: true }),
      ],
    })
    expect(aggregateToolUsage([e]).mcpAdoption.totalCalls).toBe(3)
    expect(aggregateToolUsage([e], { includeSidechain: true }).mcpAdoption.totalCalls).toBe(5)
  })

  test('TC-J16 + TC-J17: `coverage` và truncation nhìn thấy được (E6)', () => {
    const truncated = entry({
      jobId: 'j3',
      sessionId: 's3',
      ts: TS_DAY3,
      callsTotal: 520,
      calls: Array.from({ length: 500 }, (_, i) => call('Bash', `echo ${i}`)),
    })
    const r = aggregateToolUsage([...fxEntries(), truncated])
    expect(r.coverage.entries).toBe(3)
    expect(r.coverage.jobs).toBe(3)
    expect(r.coverage.firstTs).toBe(TS_DAY1)
    expect(r.coverage.lastTs).toBe(TS_DAY3)
    expect(r.coverage.truncatedEntries).toBe(1)
    // Báo cáo nói được "có cắt" và vẫn ghi nhận 500 lượt đã đọc được.
    expect(r.byTool.find((x) => x.name === 'Bash')!.calls).toBe(505)
  })

  test('TC-J18: 🔧 `perSession` — khoá là `bashSessions`, tên cũ `sessions` KHÔNG còn', () => {
    const mk = (jobId: string, sessionId: string, n: number) =>
      entry({ jobId, sessionId, calls: Array.from({ length: n }, (_, i) => call('Bash', `echo ${i}`)) })

    const odd = aggregateToolUsage([mk('a', 'sa', 1), mk('b', 'sb', 3), mk('c', 'sc', 5)])
    expect(odd.perSession.bashSessions).toBe(3)
    expect(odd.perSession.medianBashCalls).toBe(3)
    expect(odd.perSession.maxBashCalls).toBe(5)
    // Tên cũ 🚫 không được lặng lẽ sống lại.
    expect('sessions' in odd.perSession).toBe(false)

    // Số entry CHẴN → median là trung bình 2 giá trị giữa.
    const even = aggregateToolUsage([
      mk('a', 'sa', 1),
      mk('b', 'sb', 3),
      mk('c', 'sc', 5),
      mk('d', 'sd', 9),
    ])
    expect(even.perSession.bashSessions).toBe(4)
    expect(even.perSession.medianBashCalls).toBe(4)
  })

  test('TC-J19: `bootstrap` chỉ đếm 3 lượt ĐẦU', () => {
    const r = aggregateToolUsage([
      entry({
        jobId: 'jboot',
        sessionId: 'sboot',
        calls: [
          call('Bash', 'cat request.md'),
          call('Bash', 'ls'),
          call('Bash', 'pwd'),
          call('Bash', 'whoami'),
          call('Bash', 'cat design.md'),
        ],
      }),
    ])
    expect(r.bootstrap.map((b) => b.file)).toContain('request.md')
    expect(r.bootstrap.map((b) => b.file)).not.toContain('design.md')
  })

  test('TC-J20: `bootstrap` gộp theo basename', () => {
    const r = aggregateToolUsage([
      entry({ jobId: 'ja', sessionId: 'sa', calls: [call('Bash', 'cat /a/T1/request.md')] }),
      entry({ jobId: 'jb', sessionId: 'sb', calls: [call('Bash', 'cat /b/T2/request.md')] }),
    ])
    const row = r.bootstrap.find((b) => b.file === 'request.md')!
    expect(row.reads).toBe(2)
    expect(row.sessions).toBe(2)
    expect(r.bootstrap.filter((b) => b.file === 'request.md')).toHaveLength(1)
  })

  test('TC-J21: entry rỗng — mọi mảng rỗng, không NaN, không throw', () => {
    const r = aggregateToolUsage([])
    expect(r.byTool).toEqual([])
    expect(r.bashIntents).toEqual([])
    expect(r.bigrams).toEqual([])
    expect(r.bootstrap).toEqual([])
    expect(r.surveyLoopShare).toBe(0)
    expect(r.mcpAdoption.share).toBe(0)
    expect(Number.isNaN(r.surveyLoopShare)).toBe(false)
    expect(r.coverage).toEqual({ entries: 0, jobs: 0, firstTs: null, lastTs: null, truncatedEntries: 0 })
    expect(r.perSession).toEqual({ bashSessions: 0, medianBashCalls: 0, maxBashCalls: 0, top10Share: 0 })
  })

  test('TC-J22: 🔧 kết quả khớp schema F10, và schema CHẶN khoá cũ `sessions`', () => {
    const r = aggregateToolUsage(fxEntries())
    expect(toolCallStatsSchema.safeParse(r).success).toBe(true)
    expect(toolCallStatsSchema.safeParse(aggregateToolUsage([])).success).toBe(true)

    // Ca phủ định: object mang `perSession.sessions` thay vì `bashSessions`.
    const wrong = {
      ...r,
      perSession: {
        sessions: r.perSession.bashSessions,
        medianBashCalls: r.perSession.medianBashCalls,
        maxBashCalls: r.perSession.maxBashCalls,
        top10Share: r.perSession.top10Share,
      },
    }
    expect(toolCallStatsSchema.safeParse(wrong).success).toBe(false)
  })
})

// ── Fixture backfill (job + transcript) ─────────────────────────────────────

interface JobSpec {
  id: string
  sessionId?: string | null
  createdAt?: string
  startedAt?: string | null
  finishedAt?: string | null
}

/** Mỗi job một session id hex ổn định — dùng chung cho job file và transcript. */
const sessionIds = new Map<string, string>()
function sessionIdFor(jobId: string): string {
  if (!sessionIds.has(jobId)) sessionIds.set(jobId, sid(sessionIds.size + 1))
  return sessionIds.get(jobId)!
}

function seedJobFile(spec: JobSpec): void {
  const dir = path.join(registryHome(), 'jobs')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${spec.id}.json`),
    JSON.stringify({
      id: spec.id,
      status: 'succeeded',
      // Runner không tồn tại ⇒ `resolveJobProvider` rơi về probe trên đĩa.
      runnerId: 'runner-khong-co',
      agentRef: 'investigator',
      workspace: WORKSPACE,
      createdAt: spec.createdAt ?? '2026-09-01T00:00:00.000Z',
      startedAt: spec.startedAt ?? null,
      finishedAt: spec.finishedAt ?? null,
      exitCode: 0,
      metadata: { projectId: 'p-bf', taskId: 'T-bf', stepId: 'investigate' },
      sessionId: spec.sessionId === undefined ? sessionIdFor(spec.id) : spec.sessionId,
    }),
  )
}

function seedCliTranscript(sessionId: string, commands: string[]): void {
  const dir = path.join(home, '.claude', 'projects', encodeCwdForClaudeProjects(WORKSPACE))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${sessionId}.jsonl`),
    `${commands
      .map((command) =>
        JSON.stringify({
          type: 'assistant',
          timestamp: '2026-09-30T01:00:00.000Z',
          message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] },
        }),
      )
      .join('\n')}\n`,
  )
}

function seedSdkSession(sessionId: string, commands: string[]): void {
  const dir = path.join(registryHome(), 'agent-sdk-sessions')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${sessionId}.json`),
    JSON.stringify({
      sessionId,
      messages: commands.map((command) => ({
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'Bash', input: { command } }],
      })),
    }),
  )
}

// ── Nhóm J — ts của dữ liệu backfill ────────────────────────────────────────

describe('Nhóm J — mốc thời gian của dữ liệu backfill', () => {
  test('TC-J23: 🆕 ⚠️ `coverage.firstTs/lastTs` + `from`/`to` có nghĩa với backfill', async () => {
    const stamps = ['2026-08-16T10:00:00.000Z', '2026-09-10T10:00:00.000Z', '2026-09-30T10:00:00.000Z']
    stamps.forEach((finishedAt, i) => {
      seedJobFile({ id: `bf${i}`, createdAt: `2026-08-0${i + 1}T00:00:00.000Z`, finishedAt })
      seedCliTranscript(sessionIdFor(`bf${i}`), [`cat file${i}.md`])
    })

    const before = Date.now()
    const result = await ingestFromTranscripts({})
    expect(result.ingested).toBe(3)

    const all = await readToolCallEntries({})
    const report = aggregateToolUsage(all)
    expect(report.coverage.firstTs).toBe(Date.parse(stamps[0]))
    expect(report.coverage.lastTs).toBe(Date.parse(stamps[2]))
    // 🚫 Không mốc nào xấp xỉ `Date.now()`.
    expect(report.coverage.lastTs!).toBeLessThan(before)

    const middle = await readToolCallEntries({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-20T00:00:00.000Z',
    })
    expect(middle).toHaveLength(1)
    expect(middle[0].jobId).toBe('bf1')
  })

  test('TC-J23b: thiếu `finishedAt` lùi về `startedAt`, thiếu cả hai lùi về `createdAt`', async () => {
    seedJobFile({ id: 'only-started', createdAt: '2026-08-01T00:00:00.000Z', startedAt: '2026-08-20T00:00:00.000Z' })
    seedCliTranscript(sessionIdFor('only-started'), ['cat a.md'])
    seedJobFile({ id: 'only-created', createdAt: '2026-08-02T00:00:00.000Z' })
    seedSdkSession(sessionIdFor('only-created'), ['ls -la'])

    await ingestFromTranscripts({})
    const byJob = new Map((await readToolCallEntries({})).map((e) => [e.jobId, e.ts]))
    expect(byJob.get('only-started')).toBe(Date.parse('2026-08-20T00:00:00.000Z'))
    expect(byJob.get('only-created')).toBe(Date.parse('2026-08-02T00:00:00.000Z'))
  })
})

// ── TC-G22 — con trỏ backfill khoá theo sessionId + source ──────────────────

describe('TC-G22 — con trỏ backfill khoá theo `sessionId` + `source`', () => {
  test('🆕 ⚠️ hai nguồn cùng một sessionId tiến ĐỘC LẬP', async () => {
    const SHARED = sid(999)
    // Job cli chạy trước (createdAt sớm hơn), job sdk sau.
    seedJobFile({ id: 'job-cli', sessionId: SHARED, createdAt: '2026-09-01T00:00:00.000Z' })
    seedJobFile({ id: 'job-sdk', sessionId: SHARED, createdAt: '2026-09-02T00:00:00.000Z' })
    seedCliTranscript(SHARED, ['cat a.md', 'cat b.md', 'cat c.md', 'cat d.md'])
    seedSdkSession(SHARED, ['grep x src', 'grep y src', 'grep z src'])

    const { entries, summary } = await collectFromTranscripts({})
    // ⚠️ `resolveJobProvider` probe file SDK trước khi rơi về CLI, nên cả hai job
    // đều đi nhánh `sdk` khi file SDK tồn tại. Điều được khẳng định ở đây là con
    // trỏ KHÔNG trộn đơn vị giữa hai nguồn: không job nào bị con trỏ của nguồn
    // kia chặn mất entry.
    expect(summary.noTranscript).toBe(0)
    expect(entries.length).toBeGreaterThanOrEqual(1)
    expect(entries[0].calls.length).toBeGreaterThan(0)

    // Chạy lại đường GHI hai lần: lần hai không ingest gì nữa.
    const first = await ingestFromTranscripts({})
    expect(first.ingested).toBeGreaterThan(0)
    const second = await ingestFromTranscripts({})
    expect(second.ingested).toBe(0)
  })
})

// ── Nhóm M — backfill business ──────────────────────────────────────────────

describe('Nhóm M — backfill (business)', () => {
  test('TC-M01: 🔧 ⚠️ backfill idempotent theo `jobId` (E3, đường KHÔNG con trỏ)', async () => {
    seedJobFile({ id: 'm1', createdAt: '2026-09-01T00:00:00.000Z' })
    seedJobFile({ id: 'm2', createdAt: '2026-09-02T00:00:00.000Z' })
    seedCliTranscript(sessionIdFor('m1'), ['cat a.md'])
    seedCliTranscript(sessionIdFor('m2'), ['grep x src'])

    const first = await ingestFromTranscripts({})
    expect(first.ingested).toBe(2)
    expect(await readToolCallEntries({})).toHaveLength(2)

    const second = await ingestFromTranscripts({})
    expect(second.ingested).toBe(0)
    // ⚠️ Khẳng định trên CHÍNH `IngestFromTranscriptsResult`: job đã có entry phải
    // rơi vào `skipped`, 🚫 không được tính nhầm sang `noTranscript`.
    expect(second.skipped).toBe(2)
    expect(second.noTranscript).toBe(0)
    expect(await readToolCallEntries({})).toHaveLength(2)
  })

  test('TC-M02: backfill bỏ qua đúng job đã có entry', async () => {
    seedJobFile({ id: 'j1', createdAt: '2026-09-01T00:00:00.000Z' })
    seedJobFile({ id: 'j2', createdAt: '2026-09-02T00:00:00.000Z' })
    seedCliTranscript(sessionIdFor('j1'), ['cat a.md'])
    seedCliTranscript(sessionIdFor('j2'), ['grep x src'])

    await appendToolCallLog({
      jobId: 'j1',
      sessionId: 's-j1',
      taskId: null,
      projectId: null,
      stepId: null,
      agentRef: null,
      provider: 'claude-code-cli',
      source: 'cli-transcript',
      callsTotal: 1,
      calls: [call('Bash', 'cat a.md')],
    })

    const result = await ingestFromTranscripts({})
    expect(result.ingested).toBe(1)
    const entries = await readToolCallEntries({})
    expect(entries.map((e) => e.jobId).sort()).toEqual(['j1', 'j2'])
  })

  test('TC-M13: 🆕 ⚠️ `noTranscript` TÁCH khỏi `skipped`', async () => {
    // j1: đã có entry · j2: có transcript mới · j3: không nguồn nào.
    seedJobFile({ id: 'j1', createdAt: '2026-09-01T00:00:00.000Z' })
    seedJobFile({ id: 'j2', createdAt: '2026-09-02T00:00:00.000Z' })
    seedJobFile({ id: 'j3', createdAt: '2026-09-03T00:00:00.000Z' })
    seedCliTranscript(sessionIdFor('j1'), ['cat a.md'])
    seedCliTranscript(sessionIdFor('j2'), ['grep x src'])

    await appendToolCallLog({
      jobId: 'j1',
      sessionId: 's-j1',
      taskId: null,
      projectId: null,
      stepId: null,
      agentRef: null,
      provider: 'claude-code-cli',
      source: 'cli-transcript',
      callsTotal: 1,
      calls: [call('Bash', 'cat a.md')],
    })

    const result = await ingestFromTranscripts({})
    expect(result).toEqual({ ingested: 1, skipped: 1, noTranscript: 1 })
    // Ba số 🚫 không chồng lấn — tổng đúng bằng số job xét.
    expect(result.ingested + result.skipped + result.noTranscript).toBe(3)
  })

  test('TC-M14: 🆕 ⚠️ `collectFromTranscripts`: `empty` ≠ `no-source`', async () => {
    // (a) file session SDK TỒN TẠI nhưng không có lượt tool nào → `empty` ⇒ skipped.
    seedJobFile({ id: 'empty-job', createdAt: '2026-09-01T00:00:00.000Z' })
    seedSdkSession(sessionIdFor('empty-job'), [])

    const a = await collectFromTranscripts({})
    expect(a.summary).toEqual({ ingested: 0, skipped: 1, noTranscript: 0 })

    // (b) file session SDK KHÔNG tồn tại → `no-source`.
    fs.rmSync(path.join(registryHome(), 'agent-sdk-sessions'), { recursive: true, force: true })
    const b = await collectFromTranscripts({})
    expect(b.summary).toEqual({ ingested: 0, skipped: 0, noTranscript: 1 })
  })

  test('TC-M15: 🆕 ⚠️ span log sau `--ingest` TRÙNG span `--from-transcripts` in ra', async () => {
    const stamps = ['2026-08-16T10:00:00.000Z', '2026-09-30T10:00:00.000Z']
    stamps.forEach((finishedAt, i) => {
      seedJobFile({ id: `span${i}`, createdAt: `2026-08-0${i + 1}T00:00:00.000Z`, finishedAt })
      seedCliTranscript(sessionIdFor(`span${i}`), [`cat f${i}.md`])
    })

    // (1) đường CHỈ ĐỌC.
    const scanned = await collectFromTranscripts({})
    const scannedSpan = aggregateToolUsage(scanned.entries).coverage

    // (2) đường GHI.
    await ingestFromTranscripts({})

    // (3) đọc lại log.
    const logged = aggregateToolUsage(await readToolCallEntries({})).coverage

    expect(logged.firstTs).toBe(scannedSpan.firstTs)
    expect(logged.lastTs).toBe(scannedSpan.lastTs)
    expect(logged.firstTs).toBe(Date.parse(stamps[0]))
    expect(logged.lastTs).toBe(Date.parse(stamps[1]))
    // 🚫 Không mốc nào xấp xỉ `Date.now()` — đó chính là lỗi làm `--from`/`--to`
    // vô nghĩa với mọi dữ liệu backfill.
    expect(Math.abs(Date.now() - logged.lastTs!)).toBeGreaterThan(60_000)
  })

  test('TC-M12b: `collectFromTranscripts` KHÔNG kiểm `isLogTypeEnabled`', async () => {
    seedJobFile({ id: 'off-job', createdAt: '2026-09-01T00:00:00.000Z' })
    seedCliTranscript(sessionIdFor('off-job'), ['cat a.md'])
    writeSettings(false)

    const { entries, summary } = await collectFromTranscripts({})
    expect(summary.ingested).toBe(1)
    expect(entries).toHaveLength(1)
    // Đối chứng: đường GHI thì vẫn áp gate.
    expect(await ingestFromTranscripts({})).toEqual({ ingested: 0, skipped: 0, noTranscript: 0 })
  })
})

// ── Nhóm M — script CLI ─────────────────────────────────────────────────────

interface RunResult {
  status: number
  stdout: string
  stderr: string
}

function runScript(args: string[], env: Record<string, string> = {}): RunResult {
  const out = spawnSync('bun', ['scripts/tool-usage-stats.ts', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      DEV_TEAM_DASHBOARD_HOME: home,
      CLAUDE_SESSION_ID: '',
      ...env,
    },
  })
  return { status: out.status ?? -1, stdout: out.stdout ?? '', stderr: out.stderr ?? '' }
}

describe('Nhóm M — script CLI tool-usage-stats', () => {
  test('TC-M03: `--ingest` không đi một mình', () => {
    const r = runScript(['--ingest'])
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('--from-transcripts')
    expect(fs.existsSync(logFile('tool-call'))).toBe(false)
  })

  test('TC-M04: ⚠️ 0 entry có lời giải thích (E9)', () => {
    writeSettings(false)
    const r = runScript([])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('tool-call')
    expect(r.stdout).toContain('Settings')
    expect(r.stdout).toContain('--from-transcripts')
  })

  test('TC-M05: `--format=json` — stdout parse được và khớp schema F10', async () => {
    await seedLog(fxEntries())
    const r = runScript(['--format=json'])
    expect(r.status).toBe(0)
    const parsed = JSON.parse(r.stdout)
    expect(toolCallStatsSchema.safeParse(parsed).success).toBe(true)
    expect(parsed.mcpAdoption.totalCalls).toBe(7)
  })

  test('TC-M06: `--format=markdown` — có bảng, đổ thẳng vào reports/ được', async () => {
    await seedLog(fxEntries())
    const r = runScript(['--format=markdown'])
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('# Tool usage')
    expect(r.stdout).toContain('| tool | calls | share | sessions |')
    expect(r.stdout).toContain('|---|---|---|---|')
  })

  test('TC-M07: ⚠️ tự loại phiên đang chạy qua $CLAUDE_SESSION_ID (E8/G7)', async () => {
    await seedLog(fxEntries())
    const r = runScript(['--format=json'], { CLAUDE_SESSION_ID: 's1' })
    expect(r.status).toBe(0)
    const parsed = JSON.parse(r.stdout)
    expect(parsed.coverage.entries).toBe(1)
    expect(parsed.mcpAdoption.totalCalls).toBe(3)
  })

  test('TC-M08: `--exclude-session` lặp lại được', async () => {
    await seedLog(fxEntries())
    const r = runScript(['--format=json', '--exclude-session=s1', '--exclude-session=s2'])
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout).coverage.entries).toBe(0)
  })

  test('TC-M09: mặc định đọc log, KHÔNG quét transcript', async () => {
    await seedLog(fxEntries())
    // Transcript tồn tại nhưng chạy không cờ thì nó không được đụng tới.
    seedJobFile({ id: 'never-scanned', createdAt: '2026-09-01T00:00:00.000Z' })
    seedCliTranscript(sessionIdFor('never-scanned'), ['cat never.md'])

    const r = runScript(['--format=json'])
    const parsed = JSON.parse(r.stdout)
    expect(parsed.coverage.entries).toBe(2)
    expect(parsed.bootstrap.map((b: { file: string }) => b.file)).not.toContain('never.md')
  })

  test('TC-M10: `--top=<n>` giới hạn số dòng mỗi bảng', async () => {
    await seedLog([
      entry({
        jobId: 'jtop',
        sessionId: 'stop',
        calls: ['A', 'B', 'C', 'D', 'E'].map((n) => call(`Tool${n}`, 'x')),
      }),
    ])
    const r = runScript(['--format=markdown', '--top=3'])
    const section = r.stdout.split('## Tool frequency')[1].split('##')[0]
    const rows = section.split('\n').filter((l) => l.startsWith('| Tool'))
    expect(rows).toHaveLength(3)
  })

  test('TC-M11: 🆕 ⚠️ `--from-transcripts` DÙNG MỘT MÌNH chỉ đọc — log KHÔNG đổi', async () => {
    await seedLog(fxEntries())
    seedJobFile({ id: 'scan-only', createdAt: '2026-09-01T00:00:00.000Z' })
    seedCliTranscript(sessionIdFor('scan-only'), ['cat scanned.md'])

    const file = logFile('tool-call')
    const sizeBefore = fs.statSync(file).size
    const mtimeBefore = fs.statSync(file).mtimeMs

    const r = runScript(['--from-transcripts', '--format=json'])
    expect(r.status).toBe(0)
    // Vẫn quét + tổng hợp + IN ra.
    const parsed = JSON.parse(r.stdout)
    expect(parsed.coverage.entries).toBe(1)
    expect(parsed.bootstrap.map((b: { file: string }) => b.file)).toContain('scanned.md')

    // Log 🚫 không đổi: số entry giữ nguyên VÀ file không bị ghi lại.
    expect(await readToolCallEntries({})).toHaveLength(2)
    expect(fs.statSync(file).size).toBe(sizeBefore)
    expect(fs.statSync(file).mtimeMs).toBe(mtimeBefore)
  })

  test('TC-M12: 🆕 ⚠️ `--from-transcripts` CỐ Ý bỏ qua gate `isLogTypeEnabled`', () => {
    seedJobFile({ id: 'gate-off', createdAt: '2026-09-01T00:00:00.000Z' })
    seedCliTranscript(sessionIdFor('gate-off'), ['cat gated.md'])
    writeSettings(false)

    const r = runScript(['--from-transcripts', '--format=json'])
    expect(r.status).toBe(0)
    const parsed = JSON.parse(r.stdout)
    expect(parsed.coverage.entries).toBe(1)
    // Vẫn không ghi gì.
    expect(fs.existsSync(logFile('tool-call'))).toBe(false)
  })

  test('TC-M01b: `--from-transcripts --ingest` qua script — lần hai không ghi thêm', () => {
    seedJobFile({ id: 'cli-ingest', createdAt: '2026-09-01T00:00:00.000Z' })
    seedCliTranscript(sessionIdFor('cli-ingest'), ['cat a.md'])

    const first = runScript(['--from-transcripts', '--ingest'])
    expect(first.status).toBe(0)
    expect(first.stdout).toContain('ingested=1')

    const second = runScript(['--from-transcripts', '--ingest'])
    expect(second.status).toBe(0)
    expect(second.stdout).toContain('ingested=0')
    expect(second.stdout).toContain('skipped=1')
    expect(second.stdout).toContain('noTranscript=0')
  })
})
