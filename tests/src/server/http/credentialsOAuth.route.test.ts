import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/api/apiServer.js'
import type { RegistryContext } from '../../../../src/core/http/types.js'

let root: string
let home: string
let app: Awaited<ReturnType<typeof createApp>>
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME
const originalFetch = globalThis.fetch
const PREFIX = 'RUNNER_OAUTH_GEMINI_API'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

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

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-oauth-api-'))
  home = path.join(root, '.home')
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  process.env.DASHBOARD_SECRET_KEY = 'test-passphrase'
  fs.mkdirSync(home, { recursive: true })
  app = await createApp(fakeCtx())
})
afterAll(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(root, { recursive: true, force: true })
})
beforeEach(() => {
  for (const f of ['credentials.json', 'secret-vault.json']) fs.rmSync(path.join(home, f), { force: true })
  for (const suffix of ['AUTHORIZE_URL', 'TOKEN_URL', 'CLIENT_ID', 'CLIENT_SECRET', 'SCOPE']) {
    delete process.env[`${PREFIX}_${suffix}`]
  }
})
afterEach(() => {
  globalThis.fetch = originalFetch
})

function configureGeminiOAuth() {
  process.env[`${PREFIX}_AUTHORIZE_URL`] = 'https://example.test/authorize'
  process.env[`${PREFIX}_TOKEN_URL`] = 'https://example.test/token'
  process.env[`${PREFIX}_CLIENT_ID`] = 'client-123'
  process.env[`${PREFIX}_SCOPE`] = 'scope-a'
}

describe('credentials OAuth HTTP API', () => {
  test('GET capabilities is empty by default, lists a provider once its env vars are set', async () => {
    const empty = await app.request('/api/credentials/oauth/capabilities')
    expect(empty.status).toBe(200)
    expect((await empty.json()).providers).toEqual([])

    configureGeminiOAuth()
    const withGemini = await app.request('/api/credentials/oauth/capabilities')
    expect((await withGemini.json()).providers).toEqual(['gemini-api'])
  })

  test('GET capabilities reports vaultConfigured so the UI can warn before the user hits a raw error', async () => {
    const withKey = await app.request('/api/credentials/oauth/capabilities')
    expect((await withKey.json()).vaultConfigured).toBe(true)

    const savedKey = process.env.DASHBOARD_SECRET_KEY
    delete process.env.DASHBOARD_SECRET_KEY
    try {
      const withoutKey = await app.request('/api/credentials/oauth/capabilities')
      expect((await withoutKey.json()).vaultConfigured).toBe(false)
    } finally {
      process.env.DASHBOARD_SECRET_KEY = savedKey
    }
  })

  test('POST start fails for an unconfigured provider, succeeds for a configured one', async () => {
    const bad = await app.request('/api/credentials/oauth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'openai-api' }),
    })
    expect(bad.status).toBe(400)

    configureGeminiOAuth()
    const ok = await app.request('/api/credentials/oauth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'gemini-api', label: 'My Gemini' }),
    })
    expect(ok.status).toBe(200)
    const body = await ok.json()
    expect(typeof body.state).toBe('string')
    expect(body.authorizeUrl).toContain('https://example.test/authorize')
  })

  test('GET callback exchanges the code and returns an HTML success page; status reflects done', async () => {
    configureGeminiOAuth()
    const start = await app.request('/api/credentials/oauth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'gemini-api', label: 'My Gemini' }),
    })
    const { state } = await start.json()

    globalThis.fetch = (async () => jsonResponse({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 })) as unknown as typeof fetch

    const callback = await app.request(`/api/credentials/oauth/callback?state=${state}&code=code-1`)
    expect(callback.status).toBe(200)
    expect(callback.headers.get('content-type') || '').toContain('text/html')
    expect(await callback.text()).toMatch(/Connected/)

    const status = await app.request(`/api/credentials/oauth/status?state=${state}`)
    const statusBody = await status.json()
    expect(statusBody.status).toBe('done')
    expect(typeof statusBody.credentialId).toBe('string')

    const creds = await app.request('/api/credentials')
    const created = (await creds.json()).profiles.find((p: any) => p.id === statusBody.credentialId)
    expect(created?.secretRef).toBe(`oauth:${statusBody.credentialId}`)
  })

  test('POST exchange (paste mode) accepts a pasted URL and completes the same way', async () => {
    configureGeminiOAuth()
    const start = await app.request('/api/credentials/oauth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'gemini-api' }),
    })
    const { state } = await start.json()

    globalThis.fetch = (async () => jsonResponse({ access_token: 'at-2', expires_in: 3600 })) as unknown as typeof fetch

    const exchange = await app.request('/api/credentials/oauth/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, input: `https://dash.test/api/credentials/oauth/callback?code=pasted-1&state=${state}` }),
    })
    expect(exchange.status).toBe(200)
    expect(typeof (await exchange.json()).credentialId).toBe('string')
  })

  test('GET status for an unknown state is 404', async () => {
    const res = await app.request('/api/credentials/oauth/status?state=never-started')
    expect(res.status).toBe(404)
  })
})
