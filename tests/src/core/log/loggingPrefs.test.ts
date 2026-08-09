import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  invalidateLoggingPrefsCache,
  isLogTypeEnabled,
  loadLoggingPrefs,
  parseLoggingConfig,
} from '../../../../src/core/log/loggingPrefs.js'
import { appendLog, appendRequestLog, emitAudit } from '../../../../src/core/log/store.js'
import { readLogs } from '../../../../src/features/logs/business/store.js'

let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

function writeSettings(logging: unknown) {
  fs.mkdirSync(home, { recursive: true })
  fs.writeFileSync(
    path.join(home, 'settings.json'),
    JSON.stringify({ logging }, null, 2),
  )
  invalidateLoggingPrefsCache()
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-logprefs-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})

afterAll(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

beforeEach(() => {
  fs.rmSync(path.join(home, 'logs'), { recursive: true, force: true })
  try {
    fs.unlinkSync(path.join(home, 'settings.json'))
  } catch {
    /* ignore */
  }
  invalidateLoggingPrefsCache()
})

describe('parseLoggingConfig', () => {
  test('defaults audit/request/jobs/events on', () => {
    expect(parseLoggingConfig(undefined)).toEqual({
      showLogsTab: true,
      types: { audit: true, request: true, jobs: true, events: true },
    })
  })

  test('false flags stick', () => {
    expect(
      parseLoggingConfig({
        showLogsTab: false,
        types: { audit: false, request: true, jobs: false, events: false },
      }),
    ).toEqual({
      showLogsTab: false,
      types: { audit: false, request: true, jobs: false, events: false },
    })
    expect(parseLoggingConfig({ types: { events: true } }).types.events).toBe(true)
    expect(parseLoggingConfig({ types: { events: false } }).types.events).toBe(false)
  })
})

describe('isLogTypeEnabled / loadLoggingPrefs', () => {
  test('missing settings.json → all types on (incl. events)', () => {
    expect(isLogTypeEnabled('audit')).toBe(true)
    expect(isLogTypeEnabled('request')).toBe(true)
    expect(isLogTypeEnabled('jobs')).toBe(true)
    expect(isLogTypeEnabled('events')).toBe(true)
  })

  test('reads types from settings.json', () => {
    writeSettings({
      showLogsTab: true,
      types: { audit: false, request: true, jobs: false, events: true },
    })
    expect(loadLoggingPrefs().types.audit).toBe(false)
    expect(isLogTypeEnabled('audit')).toBe(false)
    expect(isLogTypeEnabled('request')).toBe(true)
    expect(isLogTypeEnabled('jobs')).toBe(false)
    expect(isLogTypeEnabled('events')).toBe(true)
  })
})

describe('write gate', () => {
  test('appendRequestLog no-ops when request disabled', async () => {
    writeSettings({ types: { request: false, audit: true, jobs: true } })
    appendRequestLog({ method: 'GET', path: '/api/x', projectId: null, status: 200, durationMs: 1 })
    await new Promise((r) => setTimeout(r, 30))
    expect(await readLogs({ type: 'request' })).toEqual([])
  })

  test('emitAudit no-ops when audit disabled', async () => {
    writeSettings({ types: { audit: false, request: true, jobs: true } })
    emitAudit({ op: 'create', entity: 'project', identifier: 'p', projectId: null })
    await new Promise((r) => setTimeout(r, 30))
    expect(await readLogs({ type: 'audit' })).toEqual([])
  })

  test('appendLog still writes when type enabled', async () => {
    writeSettings({ types: { request: true, audit: true, jobs: true } })
    await appendLog({
      type: 'request',
      ts: Date.now(),
      iso: new Date().toISOString(),
      method: 'GET',
      path: '/api/ok',
      projectId: null,
      status: 200,
      durationMs: 1,
      error: null,
      level: 'info',
      traceId: '',
      query: '',
      response: '',
    })
    const entries = await readLogs({ type: 'request' })
    expect(entries.length).toBe(1)
  })

  test('appendLog events no-ops when events disabled', async () => {
    writeSettings({ types: { audit: true, request: true, jobs: true, events: false } })
    await appendLog({
      type: 'events',
      ts: Date.now(),
      iso: new Date().toISOString(),
      level: 'info',
      traceId: '',
      event: 'job.started',
      payload: { id: 'j1' },
      projectId: null,
    })
    expect(await readLogs({ type: 'events' })).toEqual([])
  })

  test('appendLog events writes when events enabled (default)', async () => {
    writeSettings({ types: { events: true } })
    await appendLog({
      type: 'events',
      ts: Date.now(),
      iso: new Date().toISOString(),
      level: 'info',
      traceId: 'tr-1',
      event: 'entity.created',
      payload: { entity: 'project', id: 'p1' },
      projectId: 'p1',
    })
    const entries = await readLogs({ type: 'events' })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      type: 'events',
      event: 'entity.created',
      projectId: 'p1',
    })
  })
})
