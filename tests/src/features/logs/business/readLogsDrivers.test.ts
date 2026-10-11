import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getDb, resetDbForTest } from '../../../../../src/backend/db/client.js'
import { logEntries } from '../../../../../src/backend/db/schema.js'
import {
  appendLog,
  initLogDriverFromPrefs,
  resetLogDriver,
  type LogEntry,
  type LogType,
} from '../../../../../src/backend/log/index.js'
import { invalidateLoggingPrefsCache } from '../../../../../src/backend/log/loggingPrefsIo.js'
import { readLogs } from '../../../../../src/features/logs/business/store.js'

/**
 * Characterization `readLogs` trên **cả hai** driver (#444). Driver bật qua
 * `settings.json` (`logging.driver`) + `initLogDriverFromPrefs()` — đường công
 * khai, không phụ thuộc file hiện thực nào. Đường SQLite trước #444 chưa có test.
 *
 * Cô lập: `DEV_TEAM_DASHBOARD_HOME` tạm + `resetDbForTest()` sau mỗi lần đổi home
 * (connection `getDb()` cache theo process).
 */

type Kind = 'file' | 'sqlite'

let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

function writeSettings(logging: Record<string, unknown>) {
  fs.mkdirSync(home, { recursive: true })
  fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ logging }, null, 2))
  invalidateLoggingPrefsCache()
}

function activate(kind: Kind, types: Record<string, boolean> = {}) {
  writeSettings({ driver: kind, types })
  resetLogDriver()
  initLogDriverFromPrefs()
}

function req(ts: number, p: { path?: string; projectId?: string | null } = {}): LogEntry {
  return {
    type: 'request',
    ts,
    iso: new Date(ts).toISOString(),
    level: 'info',
    traceId: '',
    method: 'GET',
    path: p.path ?? `/r${ts}`,
    query: '',
    response: '',
    projectId: p.projectId ?? null,
    status: 200,
    durationMs: 1,
    error: null,
  }
}

function audit(ts: number, projectId: string | null = null): LogEntry {
  return {
    type: 'audit',
    ts,
    iso: new Date(ts).toISOString(),
    level: 'info',
    traceId: '',
    op: 'update',
    entity: 'project',
    identifier: `a${ts}`,
    projectId,
  }
}

function usage(ts: number): LogEntry {
  return {
    type: 'usage',
    ts,
    iso: new Date(ts).toISOString(),
    level: 'info',
    traceId: '',
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 2,
    estimatedCostUsd: null,
    model: null,
    provider: 'claude',
    jobId: `j${ts}`,
  }
}

function event(ts: number): LogEntry {
  return {
    type: 'events',
    ts,
    iso: new Date(ts).toISOString(),
    level: 'info',
    traceId: '',
    event: 'job.started',
    payload: {},
    projectId: null,
  }
}

/** Ghi một bản ghi hỏng (không parse được) vào kho của driver đang test. */
async function injectMalformed(kind: Kind, type: LogType, ts: number) {
  if (kind === 'file') {
    fs.mkdirSync(path.join(home, 'logs'), { recursive: true })
    fs.appendFileSync(path.join(home, 'logs', `${type}.jsonl`), 'not json\n{partial\n')
    return
  }
  const db = await getDb()
  db.insert(logEntries).values({ type, ts, level: 'info', traceId: '', projectId: null, payload: '{broken' }).run()
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-readlogs-drv-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  resetDbForTest()
})

afterAll(() => {
  resetLogDriver()
  resetDbForTest()
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  invalidateLoggingPrefsCache()
  try {
    fs.rmSync(home, { recursive: true, force: true })
  } catch {
    /* Windows: file sqlite có thể còn bị khoá ngắn sau khi đóng — thư mục tạm, bỏ qua */
  }
})

beforeEach(async () => {
  fs.rmSync(path.join(home, 'logs'), { recursive: true, force: true })
  const db = await getDb()
  db.delete(logEntries).run()
})

afterEach(() => {
  resetLogDriver()
})

for (const kind of ['file', 'sqlite'] as const) {
  describe(`readLogs — driver ${kind}`, () => {
    beforeEach(() => activate(kind))

    test('newest-first, mỗi type đọc đúng kho của nó', async () => {
      await appendLog(req(1000, { path: '/old' }))
      await appendLog(req(3000, { path: '/new' }))
      await appendLog(req(2000, { path: '/mid' }))
      await appendLog(audit(2500))
      const got = await readLogs({ type: 'request' })
      expect(got.map((e) => (e.type === 'request' ? e.path : e.type))).toEqual(['/new', '/mid', '/old'])
    })

    test('lọc theo project; `null` / bỏ trống = mọi project', async () => {
      await appendLog(req(1, { projectId: 'p1' }))
      await appendLog(req(2, { projectId: 'p2' }))
      await appendLog(req(3, { projectId: null }))
      expect((await readLogs({ type: 'request', project: 'p1' })).map((e) => e.projectId)).toEqual(['p1'])
      expect(await readLogs({ type: 'request', project: null })).toHaveLength(3)
      expect(await readLogs({ type: 'request' })).toHaveLength(3)
    })

    test('limit cắt sau khi sort newest-first', async () => {
      for (let i = 1; i <= 5; i++) await appendLog(req(i * 10))
      const got = await readLogs({ type: 'request', limit: 2 })
      expect(got.map((e) => e.ts)).toEqual([50, 40])
    })

    test('bỏ trống limit → mặc định 200', async () => {
      for (let i = 1; i <= 205; i++) await appendLog(req(i))
      const got = await readLogs({ type: 'request' })
      expect(got).toHaveLength(200)
      expect(got[0].ts).toBe(205)
    })

    test('bỏ trống type → gộp request + audit + usage (không gồm events), sort chung', async () => {
      activate(kind, { events: true })
      await appendLog(req(10))
      await appendLog(audit(30))
      await appendLog(usage(20))
      await appendLog(event(40))
      const got = await readLogs()
      expect(got.map((e) => `${e.type}:${e.ts}`)).toEqual(['audit:30', 'usage:20', 'request:10'])
    })

    test('type đang tắt → [] dù kho có dữ liệu', async () => {
      await appendLog(req(1))
      await appendLog(audit(2))
      activate(kind, { request: false })
      expect(await readLogs({ type: 'request' })).toEqual([])
      expect((await readLogs()).map((e) => e.type)).toEqual(['audit'])
    })

    test('kho trống → []', async () => {
      expect(await readLogs({ type: 'audit' })).toEqual([])
      expect(await readLogs()).toEqual([])
    })

    test('bản ghi hỏng bị bỏ qua', async () => {
      await appendLog(req(1, { path: '/ok' }))
      await injectMalformed(kind, 'request', 2)
      const got = await readLogs({ type: 'request' })
      expect(got.map((e) => (e.type === 'request' ? e.path : ''))).toEqual(['/ok'])
    })
  })
}

describe('readLogs — hành vi biên khác nhau giữa hai driver (giữ nguyên)', () => {
  test('file: bản ghi hỏng không làm kết quả ngắn hơn limit', async () => {
    activate('file')
    for (let i = 1; i <= 3; i++) await appendLog(req(i))
    await injectMalformed('file', 'request', 99)
    expect(await readLogs({ type: 'request', limit: 3 })).toHaveLength(3)
  })

  test('sqlite: limit cắt trong SQL trước khi parse → bản ghi hỏng làm kết quả ngắn hơn limit', async () => {
    activate('sqlite')
    for (let i = 1; i <= 3; i++) await appendLog(req(i))
    await injectMalformed('sqlite', 'request', 99)
    const got = await readLogs({ type: 'request', limit: 3 })
    expect(got.map((e) => e.ts)).toEqual([3, 2])
  })
})
