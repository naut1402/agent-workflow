import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../server/http/app.js'
import { createApiHandler } from '../../../server/devTeamApi.js'
import type { RegistryContext } from '../../../server/registry.js'
import { createRegistryContext } from '../../../server/registry.js'

let root: string
let app: ReturnType<typeof createApp>
let server: http.Server
let base: string

function fakeCtx(): RegistryContext {
  return {
    defaultRoot: root,
    resolveProjectRoot: (id: string | null) => (id ? null : root),
    registry: {
      list: () => ({ projects: [], defaultId: null }),
      get: () => null,
      add: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      addFromGit: async () => ({ ok: false, status: 400, error: 'stub' }) as any,
      syncGitProject: async () => ({ ok: false, status: 400, error: 'stub' }) as any,
      pushGitWorkspace: async () => ({ ok: false, status: 400, error: 'stub' }) as any,
      remove: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      validateProjectPath: (() => ({ ok: false, status: 400, error: 'stub' })) as any,
      seedDefault: () => null,
    },
  }
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-auth-'))
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tasks', 'A1'), { recursive: true })
  fs.mkdirSync(path.join(root, 'knowledge'), { recursive: true })
  fs.writeFileSync(path.join(root, '.dev-state', 'A1.json'), JSON.stringify({ current_phase: 'design' }))
  app = createApp(fakeCtx())

  const ctx = createRegistryContext({ defaultRoot: root })
  const handler = createApiHandler(ctx)
  server = http.createServer(async (r, res) => {
    const handled = await handler(r, res)
    if (!handled) {
      res.statusCode = 418
      res.end('non-api')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  fs.rmSync(root, { recursive: true, force: true })
})

describe('DEV_TEAM_API_TOKEN middleware', () => {
  afterEach(() => {
    delete process.env.DEV_TEAM_API_TOKEN
  })

  test('token unset: preserves existing behavior (GET /api/tasks → 200)', async () => {
    delete process.env.DEV_TEAM_API_TOKEN
    const res = await app.request('/api/tasks')
    expect(res.status).toBe(200)
  })

  test('token set: missing header → 401', async () => {
    process.env.DEV_TEAM_API_TOKEN = 'secret-token'
    const res = await app.request('/api/tasks')
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('unauthorized')
  })

  test('token set: Authorization: Bearer <token> → 200', async () => {
    process.env.DEV_TEAM_API_TOKEN = 'secret-token'
    const res = await app.request('/api/tasks', {
      headers: { Authorization: 'Bearer secret-token' },
    })
    expect(res.status).toBe(200)
  })

  test('token set: X-Dev-Team-Token → 200', async () => {
    process.env.DEV_TEAM_API_TOKEN = 'secret-token'
    const res = await app.request('/api/tasks', {
      headers: { 'X-Dev-Team-Token': 'secret-token' },
    })
    expect(res.status).toBe(200)
  })

  test('token set: /api/health bypasses auth', async () => {
    process.env.DEV_TEAM_API_TOKEN = 'secret-token'
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
  })
})

describe('DEV_TEAM_API_TOKEN (createApiHandler chokepoint)', () => {
  afterEach(() => {
    delete process.env.DEV_TEAM_API_TOKEN
  })

  async function req(pathname: string, headers?: Record<string, string>) {
    return fetch(`${base}${pathname}`, { headers })
  }

  test('token set: missing header → 401 for /api/knowledge/tags', async () => {
    process.env.DEV_TEAM_API_TOKEN = 'secret-token'
    const res = await req('/api/knowledge/tags')
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('unauthorized')
  })

  test('token set: Authorization: Bearer <token> → 200 for /api/knowledge/tags', async () => {
    process.env.DEV_TEAM_API_TOKEN = 'secret-token'
    const res = await req('/api/knowledge/tags', { Authorization: 'Bearer secret-token' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.tags)).toBe(true)
  })
})

