import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getDb, resetDbForTest } from '../../../../src/backend/db/client.js'
import { logEntries } from '../../../../src/backend/db/schema.js'
import {
  logRevision,
  queryLogs,
  resetLogDriver,
  setLogDriver,
  type LogDriver,
  type LogEntry,
} from '../../../../src/backend/log/index.js'
import { fileLogDriver } from '../../../../src/backend/log/fileDriver.js'
import { invalidateLoggingPrefsCache } from '../../../../src/backend/log/loggingPrefsIo.js'
import { sqliteLogDriver } from '../../../../src/backend/log/sqliteDriver.js'

/**
 * Hợp đồng đọc của `LogDriver` (#444): `query({ type, project, limit })` +
 * hook tuỳ chọn `revision?(type)`, chạy trên **cả hai** hiện thực, và hai cửa
 * đọc của barrel `queryLogs` / `logRevision` — chỗ duy nhất lọc type tắt.
 *
 * Cô lập: `DEV_TEAM_DASHBOARD_HOME` tạm + `resetDbForTest()` sau khi đổi home.
 */

let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

function writeSettings(logging: Record<string, unknown>) {
  fs.mkdirSync(home, { recursive: true })
  fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ logging }, null, 2))
  invalidateLoggingPrefsCache()
}

function req(ts: number, projectId: string | null = null): LogEntry {
  return {
    type: 'request',
    ts,
    iso: new Date(ts).toISOString(),
    level: 'info',
    traceId: '',
    method: 'GET',
    path: `/r${ts}`,
    query: '',
    response: '',
    projectId,
    status: 200,
    durationMs: 1,
    error: null,
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

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-logquery-'))
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
  try {
    fs.unlinkSync(path.join(home, 'settings.json'))
  } catch {
    /* ignore */
  }
  invalidateLoggingPrefsCache()
  const db = await getDb()
  db.delete(logEntries).run()
})

afterEach(() => {
  resetLogDriver()
})

const drivers: [string, LogDriver][] = [
  ['file', fileLogDriver],
  ['sqlite', sqliteLogDriver],
]

for (const [name, driver] of drivers) {
  describe(`LogDriver.query — ${name}`, () => {
    test('một type, newest-first', async () => {
      await driver.append(req(10))
      await driver.append(req(30))
      await driver.append(req(20))
      await driver.append(usage(25))
      const got = await driver.query({ type: 'request' })
      expect(got.map((e) => e.ts)).toEqual([30, 20, 10])
    })

    test('nhiều type → gộp, sort chung rồi mới cắt limit', async () => {
      await driver.append(req(10))
      await driver.append(usage(30))
      await driver.append(req(20))
      const got = await driver.query({ type: ['request', 'usage'], limit: 2 })
      expect(got.map((e) => `${e.type}:${e.ts}`)).toEqual(['usage:30', 'request:20'])
    })

    test('limit null / bỏ trống = không giới hạn', async () => {
      for (let i = 1; i <= 250; i++) await driver.append(usage(i))
      expect(await driver.query({ type: 'usage', limit: null })).toHaveLength(250)
      expect(await driver.query({ type: 'usage' })).toHaveLength(250)
    })

    test('lọc project; null = mọi project', async () => {
      await driver.append(req(1, 'p1'))
      await driver.append(req(2, 'p2'))
      await driver.append(req(3, null))
      expect((await driver.query({ type: 'request', project: 'p1' })).map((e) => e.projectId)).toEqual(['p1'])
      expect(await driver.query({ type: 'request', project: null })).toHaveLength(3)
    })

    test('kho trống → []', async () => {
      expect(await driver.query({ type: 'audit' })).toEqual([])
    })

    test('driver không tự lọc type tắt — đó là việc của queryLogs', async () => {
      await driver.append(req(1))
      writeSettings({ types: { request: false } })
      expect(await driver.query({ type: 'request' })).toHaveLength(1)
    })
  })

  describe(`LogDriver.revision — ${name}`, () => {
    test('có hook', () => {
      expect(typeof driver.revision).toBe('function')
    })

    test('đổi sau mỗi lần append đúng type, đứng yên khi không ghi', async () => {
      const r0 = await driver.revision!('usage')
      await driver.append(usage(1))
      const r1 = await driver.revision!('usage')
      expect(r1).not.toBe(r0)
      expect(await driver.revision!('usage')).toBe(r1)
      await driver.append(usage(2))
      const r2 = await driver.revision!('usage')
      expect(r2).not.toBe(r1)
    })

    test('ghi type khác không đổi revision của type này', async () => {
      await driver.append(usage(1))
      const before = await driver.revision!('usage')
      await driver.append(req(2))
      expect(await driver.revision!('usage')).toBe(before)
    })
  })
}

describe('queryLogs / logRevision — cửa đọc qua driver active', () => {
  test('mặc định đọc driver file', async () => {
    await fileLogDriver.append(req(1))
    expect((await queryLogs({ type: 'request' })).map((e) => e.ts)).toEqual([1])
  })

  test('đi theo driver đang active', async () => {
    const seen: unknown[] = []
    setLogDriver({
      append: async () => {},
      query: async (q) => {
        seen.push(q)
        return [req(42)]
      },
    })
    const got = await queryLogs({ type: 'request', project: 'p', limit: 5 })
    expect(got.map((e) => e.ts)).toEqual([42])
    expect(seen).toEqual([{ type: ['request'], project: 'p', limit: 5 }])
  })

  test('type tắt → [] và không gọi driver', async () => {
    writeSettings({ types: { request: false } })
    let called = false
    setLogDriver({
      append: async () => {},
      query: async () => {
        called = true
        return [req(1)]
      },
    })
    expect(await queryLogs({ type: 'request' })).toEqual([])
    expect(called).toBe(false)
  })

  test('nhiều type: type tắt bị bỏ khỏi query gửi xuống driver', async () => {
    writeSettings({ types: { audit: false } })
    const seen: unknown[] = []
    setLogDriver({
      append: async () => {},
      query: async (q) => {
        seen.push(q.type)
        return []
      },
    })
    await queryLogs({ type: ['request', 'audit', 'usage'] })
    expect(seen).toEqual([['request', 'usage']])
  })

  test('driver ném lỗi → []', async () => {
    setLogDriver({
      append: async () => {},
      query: async () => {
        throw new Error('boom')
      },
    })
    expect(await queryLogs({ type: 'request' })).toEqual([])
  })

  test('logRevision: driver không có hook → null (caller không cache)', async () => {
    setLogDriver({ append: async () => {}, query: async () => [] })
    expect(await logRevision('usage')).toBeNull()
  })

  test('logRevision: type tắt → null', async () => {
    writeSettings({ types: { usage: false } })
    expect(await logRevision('usage')).toBeNull()
  })

  test('logRevision: chuyển tiếp hook của driver active', async () => {
    setLogDriver({ append: async () => {}, query: async () => [], revision: async (t) => `rev-${t}` })
    expect(await logRevision('usage')).toBe('rev-usage')
  })

  test('logRevision: hook ném lỗi → null', async () => {
    setLogDriver({
      append: async () => {},
      query: async () => [],
      revision: async () => {
        throw new Error('boom')
      },
    })
    expect(await logRevision('usage')).toBeNull()
  })
})
