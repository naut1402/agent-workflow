import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  appendLog,
  appendRequestLog,
  emitAudit,
  readLogs,
} from '../../../../../src/features/logs/business/store.js'

// Logger store round-trips against a tmp DEV_TEAM_DASHBOARD_HOME so it never
// touches the real ~/.dev-team-dashboard.
let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

function logsDir() {
  return path.join(home, 'logs')
}
function requestFile() {
  return path.join(logsDir(), 'request.jsonl')
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-logstore-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})
afterAll(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})
beforeEach(() => {
  fs.rmSync(logsDir(), { recursive: true, force: true })
})

// readLogs is async + emit helpers are fire-and-forget; await appendLog directly
// when we need a deterministic write before reading.
async function writeRequest(p: { path: string; projectId?: string | null; status?: number }) {
  await appendLog({
    type: 'request',
    ts: Date.now(),
    iso: new Date().toISOString(),
    method: 'GET',
    path: p.path,
    projectId: p.projectId ?? null,
    status: p.status ?? 200,
    durationMs: 1,
    error: null,
  })
}

describe('logging/store', () => {
  test('append → read round-trip', async () => {
    await writeRequest({ path: '/api/tasks' })
    const entries = await readLogs({ type: 'request' })
    expect(entries.length).toBe(1)
    expect(entries[0]).toMatchObject({ type: 'request', path: '/api/tasks', status: 200 })
  })

  test('newest-first ordering', async () => {
    await appendLog({ type: 'request', ts: 1000, iso: 'a', method: 'GET', path: '/old', projectId: null, status: 200, durationMs: 1, error: null })
    await appendLog({ type: 'request', ts: 2000, iso: 'b', method: 'GET', path: '/new', projectId: null, status: 200, durationMs: 1, error: null })
    const entries = await readLogs({ type: 'request' })
    expect(entries.map((e) => (e.type === 'request' ? e.path : ''))).toEqual(['/new', '/old'])
  })

  test('filters by project', async () => {
    await writeRequest({ path: '/api/tasks', projectId: 'p1' })
    await writeRequest({ path: '/api/tasks', projectId: 'p2' })
    const entries = await readLogs({ type: 'request', project: 'p1' })
    expect(entries.length).toBe(1)
    expect(entries[0].projectId).toBe('p1')
  })

  test('respects limit', async () => {
    for (let i = 0; i < 5; i++) await writeRequest({ path: `/r${i}` })
    expect((await readLogs({ type: 'request', limit: 2 })).length).toBe(2)
  })

  test('skips malformed JSONL lines', async () => {
    await writeRequest({ path: '/api/ok' })
    fs.appendFileSync(requestFile(), 'not json\n{partial\n')
    const entries = await readLogs({ type: 'request' })
    expect(entries.length).toBe(1)
    const e = entries[0]
    expect(e.type === 'request' && e.path).toBe('/api/ok')
  })

  test('missing file → []', async () => {
    expect(await readLogs({ type: 'audit' })).toEqual([])
  })

  test('emitAudit writes an audit line', async () => {
    emitAudit({ op: 'create', entity: 'custom-agent', identifier: 'foo', projectId: 'p1' })
    // fire-and-forget — give the microtask a tick to flush
    await new Promise((r) => setTimeout(r, 20))
    const entries = await readLogs({ type: 'audit' })
    expect(entries.length).toBe(1)
    expect(entries[0]).toMatchObject({ type: 'audit', op: 'create', entity: 'custom-agent', identifier: 'foo' })
  })

  test('appendRequestLog emits a request line', async () => {
    appendRequestLog({ method: 'POST', path: '/api/x', projectId: null, status: 201, durationMs: 3 })
    await new Promise((r) => setTimeout(r, 20))
    const entries = await readLogs({ type: 'request' })
    expect(entries[0]).toMatchObject({ method: 'POST', path: '/api/x', status: 201, level: 'info' })
  })

  test('appendRequestLog derives warn/error levels from status', async () => {
    appendRequestLog({ method: 'GET', path: '/api/miss', projectId: null, status: 404, durationMs: 1 })
    appendRequestLog({ method: 'GET', path: '/api/boom', projectId: null, status: 500, durationMs: 1 })
    await new Promise((r) => setTimeout(r, 20))
    const entries = await readLogs({ type: 'request' })
    const byPath = Object.fromEntries(
      entries.filter((e) => e.type === 'request').map((e) => [e.path, e.level]),
    )
    expect(byPath['/api/miss']).toBe('warn')
    expect(byPath['/api/boom']).toBe('error')
  })

  test('emitAudit / appendRequestLog pick up ALS traceId', async () => {
    const { runWithTraceId } = await import('../../../../../src/core/log/traceContext.js')
    runWithTraceId('corr-42', () => {
      appendRequestLog({ method: 'GET', path: '/api/traced', projectId: null, status: 200, durationMs: 1 })
      emitAudit({ op: 'update', entity: 'logging', identifier: null, projectId: null })
    })
    await new Promise((r) => setTimeout(r, 20))
    const reqs = await readLogs({ type: 'request' })
    const audits = await readLogs({ type: 'audit' })
    expect(reqs[0]).toMatchObject({ path: '/api/traced', traceId: 'corr-42' })
    expect(audits[0]).toMatchObject({ entity: 'logging', traceId: 'corr-42' })
  })

  test('rotates past 5MB into a .1 backup', async () => {
    fs.mkdirSync(logsDir(), { recursive: true })
    // Pre-fill the request log just over the 5MB cap.
    fs.writeFileSync(requestFile(), Buffer.alloc(5 * 1024 * 1024 + 10, 0x61))
    await writeRequest({ path: '/api/after-rotate' })
    expect(fs.existsSync(`${requestFile()}.1`)).toBe(true)
    // The live file now holds only the post-rotation entry.
    const entries = await readLogs({ type: 'request' })
    expect(entries.length).toBe(1)
    const e = entries[0]
    expect(e.type === 'request' && e.path).toBe('/api/after-rotate')
  })
})
