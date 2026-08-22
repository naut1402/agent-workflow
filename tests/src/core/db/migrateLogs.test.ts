import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resetDbForTest } from '../../../../src/core/db/client.js'
import { migrateLogsToSqlite } from '../../../../src/core/db/migrateLogs.js'
import { logFile, logsDir } from '../../../../src/core/log/fileDriver.js'
import { readLogs } from '../../../../src/features/logs/business/store.js'
import { activeLogDriverKind, setLogDriver, resetLogDriver } from '../../../../src/core/log/driver.js'
import { sqliteLogDriver } from '../../../../src/core/log/sqliteDriver.js'

// TC-12..14 (test-spec.md B202608_2201). TC-15 (re-run behaviour) is a
// non-blocking open question (design.md §4.4 accepts duplicates on re-run) —
// covered here only to document the accepted duplicate-row behaviour.

let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

function requestLine(p: { path: string; ts: number }) {
  return JSON.stringify({
    type: 'request',
    ts: p.ts,
    iso: new Date(p.ts).toISOString(),
    level: 'info',
    traceId: '',
    method: 'GET',
    path: p.path,
    query: '',
    response: '',
    projectId: null,
    status: 200,
    durationMs: 1,
    error: null,
  })
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-migratelogs-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
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
  fs.rmSync(logsDir(), { recursive: true, force: true })
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(path.join(home, `dashboard.sqlite${suffix}`), { force: true })
  }
})

describe('migrateLogsToSqlite', () => {
  test('TC-12: migrates N valid lines and leaves the source file untouched', async () => {
    fs.mkdirSync(logsDir(), { recursive: true })
    const lines = [requestLine({ path: '/a', ts: 1 }), requestLine({ path: '/b', ts: 2 })]
    fs.writeFileSync(logFile('request'), lines.join('\n') + '\n')

    const results = await migrateLogsToSqlite()
    const requestResult = results.find((r) => r.type === 'request')
    expect(requestResult).toMatchObject({ sourceExists: true, migrated: 2, skipped: 0 })

    expect(activeLogDriverKind()).toBe('sqlite')
    const entries = await readLogs({ type: 'request' })
    expect(entries).toHaveLength(2)
    expect(entries.map((e) => (e.type === 'request' ? e.path : '')).sort()).toEqual(['/a', '/b'])

    // Source file must survive migration unmodified.
    const raw = fs.readFileSync(logFile('request'), 'utf8')
    expect(raw).toBe(lines.join('\n') + '\n')
  })

  test('TC-13: malformed lines are skipped, valid lines still migrate, counts reported', async () => {
    fs.mkdirSync(logsDir(), { recursive: true })
    const good1 = requestLine({ path: '/ok1', ts: 10 })
    const good2 = requestLine({ path: '/ok2', ts: 20 })
    fs.writeFileSync(logFile('request'), [good1, 'not json', '{partial', good2].join('\n') + '\n')

    const results = await migrateLogsToSqlite()
    const requestResult = results.find((r) => r.type === 'request')
    expect(requestResult).toMatchObject({ sourceExists: true, migrated: 2, skipped: 2 })

    const entries = await readLogs({ type: 'request' })
    expect(entries).toHaveLength(2)
  })

  test('TC-14: missing source file for one type does not stop migration of the rest', async () => {
    fs.mkdirSync(logsDir(), { recursive: true })
    // `request.jsonl` intentionally absent; `audit.jsonl` has one valid line.
    fs.writeFileSync(
      logFile('audit'),
      JSON.stringify({
        type: 'audit',
        ts: 1,
        iso: new Date(1).toISOString(),
        level: 'info',
        traceId: '',
        op: 'create',
        entity: 'project',
        identifier: 'p1',
        projectId: null,
      }) + '\n',
    )

    const results = await migrateLogsToSqlite()
    const requestResult = results.find((r) => r.type === 'request')
    const auditResult = results.find((r) => r.type === 'audit')
    expect(requestResult).toMatchObject({ sourceExists: false, migrated: 0, skipped: 0 })
    expect(auditResult).toMatchObject({ sourceExists: true, migrated: 1, skipped: 0 })

    expect(await readLogs({ type: 'request' })).toEqual([])
    expect(await readLogs({ type: 'audit' })).toHaveLength(1)
  })

  test('TC-15 (non-blocking): running twice on the same source duplicates rows', async () => {
    fs.mkdirSync(logsDir(), { recursive: true })
    fs.writeFileSync(logFile('request'), requestLine({ path: '/dup', ts: 5 }) + '\n')

    await migrateLogsToSqlite()
    await migrateLogsToSqlite()

    const entries = await readLogs({ type: 'request' })
    expect(entries).toHaveLength(2)
  })
})
