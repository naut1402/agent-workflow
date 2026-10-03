import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_LOGGING_CONFIG, parseLoggingConfig } from '../../../../src/shared/log/loggingPrefs.js'
import {
  invalidateLoggingPrefsCache,
  isLogTypeEnabled,
  loadLoggingPrefs,
} from '../../../../src/backend/log/loggingPrefsIo.js'
import { appendLog, appendRequestLog, emitAudit } from '../../../../src/backend/log/store.js'
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
  test('defaults audit/request/jobs on; events off; usage on', () => {
    expect(parseLoggingConfig(undefined)).toEqual({
      showLogsTab: true,
      types: { audit: true, request: true, jobs: true, events: false, usage: true, 'tool-call': false },
      driver: 'file',
    })
  })

  test('false flags stick; events opt-in; usage default on', () => {
    expect(
      parseLoggingConfig({
        showLogsTab: false,
        types: { audit: false, request: true, jobs: false },
      }),
    ).toEqual({
      showLogsTab: false,
      types: { audit: false, request: true, jobs: false, events: false, usage: true, 'tool-call': false },
      driver: 'file',
    })
    expect(
      parseLoggingConfig({
        types: { events: true, usage: false },
      }),
    ).toEqual({
      showLogsTab: true,
      types: { audit: true, request: true, jobs: true, events: true, usage: false, 'tool-call': false },
      driver: 'file',
    })
  })

  // Backend log chọn bằng `logging.driver`; giá trị lạ phải rơi về `file` chứ
  // không được lọt xuống `getDb()` và đẻ file SQLite ngoài ý muốn.
  test('driver: chỉ nhận sqlite; thiếu hoặc lạ đều về file', () => {
    expect(parseLoggingConfig({ driver: 'sqlite' }).driver).toBe('sqlite')
    expect(parseLoggingConfig({ driver: 'postgres' }).driver).toBe('file')
    expect(parseLoggingConfig({}).driver).toBe('file')
  })
})

describe('isLogTypeEnabled / loadLoggingPrefs', () => {
  test('missing settings.json → audit/request/jobs/usage on; events off', () => {
    expect(isLogTypeEnabled('audit')).toBe(true)
    expect(isLogTypeEnabled('request')).toBe(true)
    expect(isLogTypeEnabled('jobs')).toBe(true)
    expect(isLogTypeEnabled('events')).toBe(false)
    expect(isLogTypeEnabled('usage')).toBe(true)
  })

  test('reads types from settings.json', () => {
    writeSettings({
      showLogsTab: true,
      types: { audit: false, request: true, jobs: false, events: true, usage: false },
    })
    expect(loadLoggingPrefs().types.audit).toBe(false)
    expect(isLogTypeEnabled('audit')).toBe(false)
    expect(isLogTypeEnabled('request')).toBe(true)
    expect(isLogTypeEnabled('jobs')).toBe(false)
    expect(isLogTypeEnabled('events')).toBe(true)
    expect(isLogTypeEnabled('usage')).toBe(false)
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
    })
    const entries = await readLogs({ type: 'request' })
    expect(entries.length).toBe(1)
  })

  test('appendLog events no-ops when events disabled (default)', async () => {
    writeSettings({ types: { audit: true, request: true, jobs: true } })
    await appendLog({
      type: 'events',
      ts: Date.now(),
      iso: new Date().toISOString(),
      level: 'info',
      traceId: '',
      event: 'job.started',
      payload: { jobId: 'j1' },
      projectId: null,
    })
    expect(await readLogs({ type: 'events' })).toEqual([])
  })

  test('appendLog events writes when events enabled', async () => {
    writeSettings({ types: { events: true } })
    await appendLog({
      type: 'events',
      ts: Date.now(),
      iso: new Date().toISOString(),
      level: 'info',
      traceId: '',
      event: 'entity.created',
      payload: { entity: 'project', id: 'p1' },
      projectId: 'p1',
    })
    const entries = await readLogs({ type: 'events' })
    expect(entries.length).toBe(1)
    expect(entries[0]).toMatchObject({
      type: 'events',
      event: 'entity.created',
      projectId: 'p1',
    })
  })
})

// ── Tbefa5f4c · Nhóm B (TC-B01 … TC-B07) — khoá log type `tool-call` ──────────
//
// Khoá là chuỗi gạch nối `'tool-call'`. Một khoá camelCase lọt vào đây sẽ làm
// gate ở `appendLog` bật/tắt nhầm mà không suite nào khác nhìn thấy.
describe('Nhóm B — parseLoggingConfig · tool-call', () => {
  test('TC-B01: mặc định TẮT', () => {
    expect(parseLoggingConfig({}).types['tool-call']).toBe(false)
  })

  test('TC-B02: DEFAULT_LOGGING_CONFIG tắt tool-call và khai đủ 6 khoá', () => {
    expect(DEFAULT_LOGGING_CONFIG.types['tool-call']).toBe(false)
    expect(Object.keys(DEFAULT_LOGGING_CONFIG.types).sort()).toEqual(
      ['audit', 'events', 'jobs', 'request', 'tool-call', 'usage'].sort(),
    )
  })

  test('TC-B03: chỉ `=== true` mới bật', () => {
    expect(parseLoggingConfig({ types: { 'tool-call': true } }).types['tool-call']).toBe(true)
  })

  test('TC-B04: giá trị truthy khác KHÔNG bật', () => {
    expect(parseLoggingConfig({ types: { 'tool-call': 'true' } }).types['tool-call']).toBe(false)
    expect(parseLoggingConfig({ types: { 'tool-call': 1 } }).types['tool-call']).toBe(false)
  })

  test('TC-B05: ⚠️ prefs CŨ (5 khoá, không có tool-call) vẫn parse đủ', () => {
    const parsed = parseLoggingConfig({
      types: { audit: true, request: true, jobs: true, events: true, usage: false },
    })
    expect(parsed.types.audit).toBe(true)
    expect(parsed.types.request).toBe(true)
    expect(parsed.types.jobs).toBe(true)
    expect(parsed.types.events).toBe(true)
    expect(parsed.types.usage).toBe(false)
    expect(parsed.types['tool-call']).toBe(false)
    expect(Object.keys(parsed.types).length).toBe(6)
  })

  test('TC-B06: khoá thừa bị bỏ qua', () => {
    const parsed = parseLoggingConfig({ types: { 'tool-call': true, toolCall: true, bogus: true } })
    expect(parsed.types['tool-call']).toBe(true)
    expect(Object.keys(parsed.types)).not.toContain('toolCall')
    expect(Object.keys(parsed.types)).not.toContain('bogus')
  })

  test('TC-B07: round-trip — ghi lại prefs không mất khoá mới', () => {
    const once = parseLoggingConfig({ types: { 'tool-call': true } })
    expect(parseLoggingConfig(once)).toEqual(once)
  })
})
