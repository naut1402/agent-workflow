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
  setLogDriver,
  type LogDriver,
  type LogEntry,
  type LogQuery,
  type UsageLogEntry,
} from '../../../../../src/backend/log/index.js'
import { invalidateLoggingPrefsCache } from '../../../../../src/backend/log/loggingPrefsIo.js'
import { StatisticsBusiness } from '../../../../../src/features/statistics/business/index.js'
import {
  getUsageStats,
  readUsageEntries,
  resetUsageStatsCacheForTest,
} from '../../../../../src/features/statistics/business/usageStats.js'

/**
 * Đường đọc usage của statistics qua phía đọc log (#445): hành vi công khai
 * (`getUsageStats` / `StatisticsBusiness.usageStats`) trên **cả hai** driver,
 * cùng hợp đồng cache theo `revision` của `LogDriver`.
 *
 * - Driver `file`: characterization — kết quả phải giống hệt trước refactor.
 * - Driver `sqlite`: trước #445 mode Thống kê rỗng; sau #445 có số liệu
 *   (thay đổi hành vi có chủ đích).
 *
 * Cô lập: `DEV_TEAM_DASHBOARD_HOME` tạm + `resetDbForTest()` sau khi đổi home.
 */

type Kind = 'file' | 'sqlite'

let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

const T0 = Date.parse('2026-08-01T10:00:00.000Z')
const T1 = Date.parse('2026-08-01T12:00:00.000Z')
const T2 = Date.parse('2026-08-02T09:00:00.000Z')

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

function usage(p: {
  ts: number
  jobId: string
  taskId?: string | null
  projectId?: string | null
  totalTokens: number
  durationMs?: number | null
}): UsageLogEntry {
  return {
    type: 'usage',
    ts: p.ts,
    iso: new Date(p.ts).toISOString(),
    level: 'info',
    traceId: '',
    inputTokens: p.totalTokens,
    outputTokens: 0,
    totalTokens: p.totalTokens,
    estimatedCostUsd: null,
    model: null,
    provider: 'claude-code-cli',
    taskId: p.taskId ?? null,
    projectId: p.projectId ?? 'p1',
    stepId: 'implement',
    jobId: p.jobId,
    durationMs: p.durationMs ?? null,
  }
}

function request(ts: number): LogEntry {
  return {
    type: 'request',
    ts,
    iso: new Date(ts).toISOString(),
    level: 'info',
    traceId: '',
    method: 'GET',
    path: '/x',
    query: '',
    response: '',
    projectId: 'p1',
    status: 200,
    durationMs: 1,
    error: null,
  }
}

function usageFile() {
  return path.join(home, 'logs', 'usage.jsonl')
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-usagestats-drv-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  resetDbForTest()
})

afterAll(() => {
  resetLogDriver()
  resetDbForTest()
  resetUsageStatsCacheForTest()
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
  resetUsageStatsCacheForTest()
  fs.rmSync(path.join(home, 'logs'), { recursive: true, force: true })
  const db = await getDb()
  db.delete(logEntries).run()
})

afterEach(() => {
  resetLogDriver()
  resetUsageStatsCacheForTest()
})

describe('statistics usage — driver file (characterization)', () => {
  beforeEach(() => activate('file'))

  test('group cùng totalTokens giữ thứ tự ghi (tie-break theo thứ tự xuất hiện)', async () => {
    await appendLog(usage({ ts: T0, jobId: 'j1', taskId: 'TA', totalTokens: 100 }))
    await appendLog(usage({ ts: T1, jobId: 'j2', taskId: 'TB', totalTokens: 100 }))
    await appendLog(usage({ ts: T2, jobId: 'j3', taskId: 'TC', totalTokens: 100 }))
    const r = await getUsageStats({ groupBy: 'task' })
    expect(r.groups.map((g) => g.key)).toEqual(['TA', 'TB', 'TC'])
  })

  test('dòng type khác lọt vào usage.jsonl bị bỏ qua', async () => {
    await appendLog(usage({ ts: T0, jobId: 'j1', taskId: 'TA', totalTokens: 10 }))
    fs.appendFileSync(usageFile(), `${JSON.stringify(request(T1))}\n`)
    const r = await getUsageStats({ groupBy: 'task' })
    expect(r.totals.entries).toBe(1)
    expect(r.groups.map((g) => g.key)).toEqual(['TA'])
  })

  test('chỉ đọc file sống — bản xoay vòng `.1` không vào thống kê', async () => {
    fs.mkdirSync(path.join(home, 'logs'), { recursive: true })
    fs.writeFileSync(`${usageFile()}.1`, `${JSON.stringify(usage({ ts: T0, jobId: 'old', taskId: 'OLD', totalTokens: 999 }))}\n`)
    await appendLog(usage({ ts: T1, jobId: 'j1', taskId: 'TA', totalTokens: 10 }))
    const r = await getUsageStats({ groupBy: 'task' })
    expect(r.groups.map((g) => g.key)).toEqual(['TA'])
  })

  test('type usage tắt trong settings → rỗng dù file có dữ liệu', async () => {
    await appendLog(usage({ ts: T0, jobId: 'j1', taskId: 'TA', totalTokens: 10 }))
    activate('file', { usage: false })
    expect(await readUsageEntries()).toEqual([])
    const r = await getUsageStats({ groupBy: 'task' })
    expect(r.groups).toEqual([])
    expect(r.totals.entries).toBe(0)
  })

  test('file bị xoá sau lần đọc có cache → rỗng', async () => {
    await appendLog(usage({ ts: T0, jobId: 'j1', taskId: 'TA', totalTokens: 10 }))
    expect((await getUsageStats({ groupBy: 'task' })).totals.entries).toBe(1)
    fs.rmSync(usageFile())
    expect((await getUsageStats({ groupBy: 'task' })).totals.entries).toBe(0)
  })

  test('StatisticsBusiness.usageStats: lọc project + bounds from/to', async () => {
    await appendLog(usage({ ts: T0, jobId: 'j1', taskId: 'TA', totalTokens: 10 }))
    await appendLog(usage({ ts: T1, jobId: 'j2', taskId: 'TB', totalTokens: 20 }))
    await appendLog(usage({ ts: T2, jobId: 'j3', taskId: 'TC', totalTokens: 30, projectId: 'p2' }))
    const r = await new StatisticsBusiness(home).usageStats({ groupBy: 'task', project: 'p1' }, { fromMs: T1 })
    expect(r.groups.map((g) => g.key)).toEqual(['TB'])
    expect(r.totals.totalTokens).toBe(20)
  })
})

describe('statistics usage — driver sqlite (thay đổi có chủ đích: trước #445 rỗng)', () => {
  beforeEach(() => activate('sqlite'))

  test('đọc usage từ log_entries — có số liệu', async () => {
    await appendLog(usage({ ts: T0, jobId: 'j1', taskId: 'TA', totalTokens: 100, durationMs: 1_000 }))
    await appendLog(usage({ ts: T1, jobId: 'j2', taskId: 'TA', totalTokens: 300, durationMs: 3_000 }))
    await appendLog(usage({ ts: T2, jobId: 'j3', taskId: 'TB', totalTokens: 900 }))
    await appendLog(request(T2))
    const r = await getUsageStats({ groupBy: 'task' })
    expect(r.groups.map((g) => g.key)).toEqual(['TB', 'TA'])
    expect(r.totals.entries).toBe(3)
    expect(r.totals.totalTokens).toBe(1300)
    const ta = r.groups[1]
    expect(ta.avgDurationMs).toBe(2_000)
    expect(ta.firstTs).toBe(T0)
    expect(ta.lastTs).toBe(T1)
  })

  test('không bị giới hạn 200 dòng của mode Logs', async () => {
    for (let i = 0; i < 205; i++) await appendLog(usage({ ts: T0 + i, jobId: `j${i}`, taskId: 'TA', totalTokens: 1 }))
    expect((await getUsageStats({ groupBy: 'task' })).totals.entries).toBe(205)
  })

  test('ghi thêm entry → thấy ngay lần gọi kế (cache theo revision)', async () => {
    await appendLog(usage({ ts: T0, jobId: 'j1', taskId: 'TA', totalTokens: 10 }))
    expect((await getUsageStats({ groupBy: 'task' })).totals.entries).toBe(1)
    await appendLog(usage({ ts: T1, jobId: 'j2', taskId: 'TA', totalTokens: 10 }))
    expect((await getUsageStats({ groupBy: 'task' })).totals.entries).toBe(2)
  })

  test('group cùng totalTokens giữ thứ tự thời gian tăng dần như driver file', async () => {
    await appendLog(usage({ ts: T0, jobId: 'j1', taskId: 'TA', totalTokens: 100 }))
    await appendLog(usage({ ts: T1, jobId: 'j2', taskId: 'TB', totalTokens: 100 }))
    const r = await getUsageStats({ groupBy: 'task' })
    expect(r.groups.map((g) => g.key)).toEqual(['TA', 'TB'])
  })

  test('type usage tắt → rỗng', async () => {
    await appendLog(usage({ ts: T0, jobId: 'j1', taskId: 'TA', totalTokens: 10 }))
    activate('sqlite', { usage: false })
    expect((await getUsageStats({ groupBy: 'task' })).totals.entries).toBe(0)
  })
})

describe('statistics usage — hợp đồng cache theo LogDriver.revision', () => {
  function fakeDriver(entries: LogEntry[], opts: { revision?: () => string | null } = {}) {
    const calls: LogQuery[] = []
    const driver: LogDriver = {
      async append() {},
      async query(q) {
        calls.push(q)
        return [...entries].sort((a, b) => b.ts - a.ts)
      },
      ...(opts.revision ? { revision: async () => opts.revision!() } : {}),
    }
    return { driver, calls }
  }

  beforeEach(() => writeSettings({}))

  test('đọc toàn bộ usage: type `usage`, không giới hạn, mọi project', async () => {
    const { driver, calls } = fakeDriver([usage({ ts: T0, jobId: 'j1', taskId: 'TA', totalTokens: 1 })])
    setLogDriver(driver)
    await readUsageEntries()
    expect(calls).toHaveLength(1)
    const q = calls[0]
    expect(q.type === 'usage' || (Array.isArray(q.type) && q.type.length === 1 && q.type[0] === 'usage')).toBe(true)
    expect(q.limit ?? null).toBe(null)
    expect(q.project ?? null).toBe(null)
  })

  test('revision không đổi → không query lại; revision đổi → query lại', async () => {
    let rev = 'r1'
    const { driver, calls } = fakeDriver([usage({ ts: T0, jobId: 'j1', taskId: 'TA', totalTokens: 1 })], {
      revision: () => rev,
    })
    setLogDriver(driver)
    await getUsageStats({ groupBy: 'task' })
    await getUsageStats({ groupBy: 'task' })
    expect(calls).toHaveLength(1)
    rev = 'r2'
    await getUsageStats({ groupBy: 'task' })
    expect(calls).toHaveLength(2)
  })

  test('driver không có revision → không cache, mỗi lần đọc đều query', async () => {
    const { driver, calls } = fakeDriver([usage({ ts: T0, jobId: 'j1', taskId: 'TA', totalTokens: 1 })])
    setLogDriver(driver)
    await getUsageStats({ groupBy: 'task' })
    await getUsageStats({ groupBy: 'task' })
    expect(calls).toHaveLength(2)
  })

  test('revision null → không cache', async () => {
    const { driver, calls } = fakeDriver([usage({ ts: T0, jobId: 'j1', taskId: 'TA', totalTokens: 1 })], {
      revision: () => null,
    })
    setLogDriver(driver)
    await getUsageStats({ groupBy: 'task' })
    await getUsageStats({ groupBy: 'task' })
    expect(calls).toHaveLength(2)
  })

  test('đổi driver cùng chuỗi revision → không trả cache của driver cũ', async () => {
    const a = fakeDriver([usage({ ts: T0, jobId: 'j1', taskId: 'TA', totalTokens: 1 })], { revision: () => '1' })
    const b = fakeDriver(
      [
        usage({ ts: T0, jobId: 'j1', taskId: 'TA', totalTokens: 1 }),
        usage({ ts: T1, jobId: 'j2', taskId: 'TB', totalTokens: 2 }),
      ],
      { revision: () => '1' },
    )
    setLogDriver(a.driver)
    expect((await getUsageStats({ groupBy: 'task' })).totals.entries).toBe(1)
    setLogDriver(b.driver)
    expect((await getUsageStats({ groupBy: 'task' })).totals.entries).toBe(2)
  })
})
