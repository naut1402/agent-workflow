import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/api/apiServer.js'
import { readLogs } from '../../../../src/features/logs/business/store.js'
import type { RegistryContext } from '../../../../src/core/http/types.js'

// Integration tests via Hono's app.request — no server boot, no node req/res
// mock. This is the testability win of the Hono migration: routing + the
// root-resolution middleware are exercised directly against an in-memory app.

let root: string
let app: Awaited<ReturnType<typeof createApp>>

// Minimal fake ctx: unknown project → null root; default → fixture root.
function fakeCtx(): RegistryContext {
  return {
    defaultRoot: root,
    resolveProjectRoot: (id: string | null) => (id ? null : root),
    registry: {
      list: () => ({ projects: [], defaultId: null }),
      get: () => null,
      add: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      remove: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      validateProjectPath: (() => ({ ok: false, status: 400, error: 'stub' })) as any,
      seedDefault: () => null,
    },
  }
}

const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-appreq-'))
  // Keep audit logs (emitted by mutation routes) inside the tmp root.
  process.env.DEV_TEAM_DASHBOARD_HOME = path.join(root, '.home')
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tasks', 'A1'), { recursive: true })
  fs.writeFileSync(path.join(root, '.dev-state', 'A1.json'), JSON.stringify({ current_phase: 'design' }))
  app = await createApp(fakeCtx())
})

afterAll(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(root, { recursive: true, force: true })
})

describe('app.request routing', () => {
  test('GET /api/tasks → 200 with root + no-store header', async () => {
    const res = await app.request('/api/tasks')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body.root).toBe(root)
    expect(body.tasks.length).toBe(1)
  })

  test('unknown project → 404 unknown project', async () => {
    const res = await app.request('/api/tasks?project=ghost')
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('unknown project')
  })

  test('GET /api/pipeline-config → 200 with steps', async () => {
    const res = await app.request('/api/pipeline-config')
    expect(res.status).toBe(200)
    expect(Array.isArray((await res.json()).pipeline.steps)).toBe(true)
  })

  test('GET /api/projects → list from registry stub', async () => {
    const res = await app.request('/api/projects')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ projects: [], defaultId: null })
  })

  test('PUT /api/projects → 405 method not allowed', async () => {
    const res = await app.request('/api/projects', { method: 'PUT' })
    expect(res.status).toBe(405)
  })

  test('unknown endpoint → 404 unknown endpoint', async () => {
    const res = await app.request('/api/nope')
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('unknown endpoint')
  })

  test('POST /api/flow-profile then GET roundtrip', async () => {
    const save = await app.request('/api/flow-profile?id=A1', {
      method: 'POST',
      body: JSON.stringify({ ok: 1 }),
    })
    expect(save.status).toBe(200)
    const get = await app.request('/api/flow-profile?id=A1')
    expect((await get.json()).profile).toEqual({ ok: 1 })
  })

  test('POST /api/pipeline-config-write invalid → 400', async () => {
    const res = await app.request('/api/pipeline-config-write', {
      method: 'POST',
      body: JSON.stringify({ scope: 'global' }),
    })
    expect(res.status).toBe(400)
  })

  // ── Logging endpoints ──────────────────────────────────────────────────────
  test('GET /api/logs → 200 with no-store', async () => {
    const res = await app.request('/api/logs')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(Array.isArray((await res.json()).entries)).toBe(true)
  })

  test('a mutation is recorded in the audit log', async () => {
    const save = await app.request('/api/pipeline-profiles', {
      method: 'POST',
      body: JSON.stringify({ name: 'audit-me', pipeline: { steps: [] } }),
    })
    expect(save.status).toBe(200)
    await new Promise((r) => setTimeout(r, 20)) // emitAudit is fire-and-forget
    const res = await app.request('/api/logs?type=audit')
    const entries = (await res.json()).entries as any[]
    expect(entries.some((e) => e.entity === 'pipeline-profile' && e.identifier === 'audit-me')).toBe(true)
  })

  test('GET /api/jobs/:id/log → 400 on bad id', async () => {
    const res = await app.request('/api/jobs/not-a-uuid/log')
    expect(res.status).toBe(400)
  })

  test('GET /api/jobs/:id/log → 200 empty for missing log', async () => {
    const res = await app.request('/api/jobs/11111111-2222-4333-8444-555555555555/log')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ text: '', size: 0 })
  })
})
