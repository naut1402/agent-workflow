import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../server/http/app.js'
import type { RegistryContext } from '../../../server/registry.js'

let root: string
let home: string
let app: ReturnType<typeof createApp>
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

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

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-conn-api-'))
  home = path.join(root, '.home')
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  fs.mkdirSync(home, { recursive: true })
  app = createApp(fakeCtx())
})

afterAll(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  for (const f of ['runners.json', 'credentials.json', 'connections.json']) {
    fs.rmSync(path.join(home, f), { force: true })
  }
})

describe('connections & runners HTTP API', () => {
  test('GET /api/connections → seed local Claude + provider catalog', async () => {
    const res = await app.request('/api/connections')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.connections[0].id).toBe('claude-code-cli-local')
    expect(body.connections[0].kind).toBe('local-console')
    expect(body.providers.some((p: any) => p.id === 'claude-code-cli' && p.kind === 'local-console')).toBe(
      true,
    )
    expect(body.providers.some((p: any) => p.id === 'anthropic-api' && p.kind === 'ai-provider')).toBe(true)
  })

  test('GET /api/connections/scan → stable command shape', async () => {
    const res = await app.request('/api/connections/scan')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.commands.length).toBe(3)
    for (const c of body.commands) {
      expect(c).toMatchObject({
        id: expect.any(String),
        command: expect.any(String),
        available: expect.any(Boolean),
        providerId: expect.any(String),
      })
    }
  })

  test('POST /api/connections local-console + ai-provider validation', async () => {
    const bad = await app.request('/api/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection: { id: 'x', kind: 'local-console', providerId: 'cursor-cli' } }),
    })
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toMatch(/cliPath/)

    const ok = await app.request('/api/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connection: {
          id: 'cursor-local',
          label: 'Cursor',
          kind: 'local-console',
          providerId: 'cursor-cli',
          cliPath: 'cursor',
          flags: ['--print'],
        },
      }),
    })
    expect(ok.status).toBe(200)
    expect((await ok.json()).connection.id).toBe('cursor-local')

    const aiBad = await app.request('/api/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connection: { id: 'api1', kind: 'ai-provider', providerId: 'anthropic-api' },
      }),
    })
    expect(aiBad.status).toBe(400)

    const aiOk = await app.request('/api/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connection: {
          id: 'api1',
          kind: 'ai-provider',
          providerId: 'anthropic-api',
          credentialId: 'claude-default',
          label: 'Anthropic',
        },
      }),
    })
    expect(aiOk.status).toBe(200)
  })

  test('GET /api/runners returns connectionId + providers catalog; POST requires connectionId', async () => {
    const list = await app.request('/api/runners')
    expect(list.status).toBe(200)
    const listed = await list.json()
    expect(listed.runners).toEqual([])
    expect(Array.isArray(listed.providers)).toBe(true)
    expect(listed.providers[0]).toMatchObject({ id: expect.any(String), kind: expect.any(String) })

    const bad = await app.request('/api/runners', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runner: { id: 'r1', name: 'R1' } }),
    })
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toBe('connectionId is required')

    const ok = await app.request('/api/runners', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runner: {
          id: 'r1',
          name: 'R1',
          connectionId: 'claude-code-cli-local',
          enabled: true,
          config: { timeoutMs: 1000 },
        },
      }),
    })
    expect(ok.status).toBe(200)
    expect((await ok.json()).runner.connectionId).toBe('claude-code-cli-local')
  })

  test('DELETE last runner allowed; empty list persists', async () => {
    await app.request('/api/runners', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runner: { id: 'only', name: 'Only', connectionId: 'claude-code-cli-local' },
      }),
    })
    const del = await app.request('/api/runners?id=only', { method: 'DELETE' })
    expect(del.status).toBe(200)
    const list = await app.request('/api/runners')
    expect((await list.json()).runners).toEqual([])
  })

  test('legacy provider+credentialId POST migrates to connectionId', async () => {
    const res = await app.request('/api/runners', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runner: {
          id: 'legacy',
          name: 'Legacy',
          provider: 'claude-code-cli',
          credentialId: 'claude-default',
          config: { cliPath: 'claude' },
        },
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.runner.connectionId).toBe('claude-code-cli-local')
    expect(body.runner.config).not.toHaveProperty('cliPath')
  })
})
