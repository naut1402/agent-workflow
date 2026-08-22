import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resetDbForTest } from '../../../../../src/core/db/client.js'
import { activeLogDriverKind, resetLogDriver } from '../../../../../src/core/log/driver.js'
import { initLogDriverFromPrefs } from '../../../../../src/core/log/driverInit.js'
import { invalidateLoggingPrefsCache } from '../../../../../src/core/log/loggingPrefsIo.js'
import { appendLog } from '../../../../../src/core/log/store.js'
import { readLogs } from '../../../../../src/features/logs/business/store.js'

// TC-08..11 (test-spec.md B202608_2201) — `logging.driver` toggle + file/sqlite
// backend parity. TC-01..07/16 (direct driver behaviour) live in
// tests/src/core/log/sqliteDriver.test.ts.

let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

function writeSettings(logging: unknown) {
  fs.mkdirSync(home, { recursive: true })
  fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ logging }))
  invalidateLoggingPrefsCache()
}

function requestEntry(p: { path: string; projectId?: string | null; ts?: number }) {
  return {
    type: 'request' as const,
    ts: p.ts ?? 1000,
    iso: '2026-01-01T00:00:00.000Z',
    level: 'info' as const,
    traceId: '',
    method: 'GET',
    path: p.path,
    query: '',
    response: '',
    projectId: p.projectId ?? null,
    status: 200,
    durationMs: 1,
    error: null,
  }
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-logstore-sqlite-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})

afterAll(() => {
  resetLogDriver()
  resetDbForTest()
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

beforeEach(() => {
  resetLogDriver()
  resetDbForTest()
  fs.rmSync(path.join(home, 'logs'), { recursive: true, force: true })
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(path.join(home, `dashboard.sqlite${suffix}`), { force: true })
  }
  try {
    fs.unlinkSync(path.join(home, 'settings.json'))
  } catch {
    /* ignore */
  }
  invalidateLoggingPrefsCache()
})

describe('logging.driver config', () => {
  test('TC-09: driver=sqlite routes subsequent append/read through sqlite', async () => {
    writeSettings({ driver: 'sqlite' })
    initLogDriverFromPrefs()
    expect(activeLogDriverKind()).toBe('sqlite')

    await appendLog(requestEntry({ path: '/api/x' }))
    expect(await readLogs({ type: 'request' })).toHaveLength(1)
    // File backend was never touched.
    expect(fs.existsSync(path.join(home, 'logs', 'request.jsonl'))).toBe(false)
  })

  test('TC-10: unsupported/missing driver value falls back to file, never throws', () => {
    writeSettings({ driver: 'postgres' })
    expect(() => initLogDriverFromPrefs()).not.toThrow()
    expect(activeLogDriverKind()).toBe('file')

    writeSettings({})
    expect(() => initLogDriverFromPrefs()).not.toThrow()
    expect(activeLogDriverKind()).toBe('file')
  })

  test('TC-11: type on/off toggle still gates writes after switching to sqlite', async () => {
    writeSettings({ driver: 'sqlite', types: { request: false, audit: true, jobs: true } })
    initLogDriverFromPrefs()
    await appendLog(requestEntry({ path: '/api/blocked' }))
    expect(await readLogs({ type: 'request' })).toEqual([])
  })
})

describe('TC-08: file vs sqlite backend parity', () => {
  test('same input → identical read result across backends', async () => {
    const inputs = [
      requestEntry({ path: '/api/a', projectId: 'p1', ts: 1000 }),
      requestEntry({ path: '/api/b', projectId: 'p2', ts: 2000 }),
      requestEntry({ path: '/api/c', projectId: 'p1', ts: 3000 }),
    ]

    writeSettings({ driver: 'file' })
    initLogDriverFromPrefs()
    for (const entry of inputs) await appendLog(entry)
    const fileResult = await readLogs({ type: 'request', project: 'p1' })

    fs.rmSync(path.join(home, 'logs'), { recursive: true, force: true })
    writeSettings({ driver: 'sqlite' })
    initLogDriverFromPrefs()
    for (const entry of inputs) await appendLog(entry)
    const sqliteResult = await readLogs({ type: 'request', project: 'p1' })

    expect(sqliteResult).toEqual(fileResult)
    expect(sqliteResult.length).toBe(2)
  })
})
