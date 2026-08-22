import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resetDbForTest } from '../../../../src/core/db/client.js'
import { resetLogDriver, setLogDriver } from '../../../../src/core/log/driver.js'
import { sqliteLogDriver } from '../../../../src/core/log/sqliteDriver.js'
import { appendLog } from '../../../../src/core/log/store.js'
import { readLogs } from '../../../../src/features/logs/business/store.js'

// TC-01..07, TC-16 (test-spec.md B202608_2201) exercised against the sqlite
// LogDriver directly — settings.json driver toggle is covered separately in
// tests/src/features/logs/business/store.sqlite.test.ts (TC-08..11).

let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-sqlitedriver-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  // `events` is opt-in (off by default) — enable it so TC-02 can exercise all 4 types.
  fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ logging: { types: { events: true } } }))
  setLogDriver(sqliteLogDriver)
})

afterAll(() => {
  resetLogDriver()
  resetDbForTest()
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

beforeEach(() => {
  resetDbForTest()
  fs.rmSync(path.join(home, 'dashboard.sqlite'), { force: true })
  fs.rmSync(path.join(home, 'dashboard.sqlite-wal'), { force: true })
  fs.rmSync(path.join(home, 'dashboard.sqlite-shm'), { force: true })
})

function requestEntry(p: { path: string; projectId?: string | null; ts?: number }) {
  return {
    type: 'request' as const,
    ts: p.ts ?? Date.now(),
    iso: new Date().toISOString(),
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

describe('sqliteLogDriver — write/read round-trip', () => {
  test('TC-01: append then read returns the same entry, fields intact', async () => {
    await appendLog(requestEntry({ path: '/api/tasks', projectId: 'p1' }))
    const entries = await readLogs({ type: 'request' })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ type: 'request', path: '/api/tasks', projectId: 'p1', status: 200 })
  })

  test('TC-02: each type reads back only its own entries', async () => {
    await appendLog(requestEntry({ path: '/api/req' }))
    await appendLog({
      type: 'audit',
      ts: Date.now(),
      iso: new Date().toISOString(),
      level: 'info',
      traceId: '',
      op: 'create',
      entity: 'project',
      identifier: 'p1',
      projectId: null,
    })
    await appendLog({
      type: 'events',
      ts: Date.now(),
      iso: new Date().toISOString(),
      level: 'info',
      traceId: '',
      event: 'job.started',
      payload: {},
      projectId: null,
    })
    await appendLog({
      type: 'usage',
      ts: Date.now(),
      iso: new Date().toISOString(),
      level: 'info',
      traceId: '',
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      estimatedCostUsd: null,
      model: null,
      provider: 'anthropic',
      jobId: 'j1',
    })
    expect(await readLogs({ type: 'request' })).toHaveLength(1)
    expect(await readLogs({ type: 'audit' })).toHaveLength(1)
    expect(await readLogs({ type: 'events' })).toHaveLength(1)
    expect(await readLogs({ type: 'usage' })).toHaveLength(1)
  })

  test('TC-03: entry without projectId shows up unfiltered but not under any specific project', async () => {
    await appendLog(requestEntry({ path: '/api/system', projectId: null }))
    expect(await readLogs({ type: 'request' })).toHaveLength(1)
    expect(await readLogs({ type: 'request', project: 'p1' })).toEqual([])
  })

  test('TC-04: entries separate cleanly by projectId', async () => {
    await appendLog(requestEntry({ path: '/api/a', projectId: 'P1' }))
    await appendLog(requestEntry({ path: '/api/b', projectId: 'P2' }))
    const p1 = await readLogs({ type: 'request', project: 'P1' })
    expect(p1).toHaveLength(1)
    expect(p1[0]).toMatchObject({ path: '/api/a', projectId: 'P1' })
  })

  test('TC-05: limit caps result count and returns newest-first', async () => {
    await appendLog(requestEntry({ path: '/r0', ts: 1000 }))
    await appendLog(requestEntry({ path: '/r1', ts: 2000 }))
    await appendLog(requestEntry({ path: '/r2', ts: 3000 }))
    const entries = await readLogs({ type: 'request', limit: 2 })
    expect(entries).toHaveLength(2)
    expect(entries.map((e) => (e.type === 'request' ? e.path : ''))).toEqual(['/r2', '/r1'])
  })

  test('TC-06: append never throws even when the backend cannot write', async () => {
    resetDbForTest()
    // Point the shared connection at a path that cannot become a directory —
    // a plain file where the DB home is expected.
    const blocked = path.join(home, 'blocked-home')
    fs.writeFileSync(blocked, 'not a directory')
    const prev = process.env.DEV_TEAM_DASHBOARD_HOME
    process.env.DEV_TEAM_DASHBOARD_HOME = blocked
    try {
      await expect(sqliteLogDriver.append(requestEntry({ path: '/api/boom' }))).resolves.toBeUndefined()
    } finally {
      process.env.DEV_TEAM_DASHBOARD_HOME = prev
      resetDbForTest()
    }
  })

  test('TC-07: read returns [] (never throws) when the backend cannot open', async () => {
    resetDbForTest()
    const blocked = path.join(home, 'blocked-home-2')
    fs.writeFileSync(blocked, 'not a directory')
    const prev = process.env.DEV_TEAM_DASHBOARD_HOME
    process.env.DEV_TEAM_DASHBOARD_HOME = blocked
    try {
      await expect(readLogs({ type: 'request' })).resolves.toEqual([])
    } finally {
      process.env.DEV_TEAM_DASHBOARD_HOME = prev
      resetDbForTest()
    }
  })

  test('TC-16: a read in flight is not blocked/broken by a concurrent write (WAL)', async () => {
    await appendLog(requestEntry({ path: '/api/before' }))
    const [entries] = await Promise.all([
      readLogs({ type: 'request' }),
      appendLog(requestEntry({ path: '/api/concurrent' })),
    ])
    expect(entries.length).toBeGreaterThanOrEqual(1)
  })
})
