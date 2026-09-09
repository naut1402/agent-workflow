import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sign } from 'hono/jwt'
import { createApp } from '../../../../src/api/apiServer'
import { createRegistryContext } from '../../../../src/core/registry'
import { saveSecurityConfig } from '../../../../src/features/settings/business/dashboardSettings'
import { __resetRateLimitBuckets } from '../../../../src/core/http/security/rateLimiter'

// Cross-cutting integration: middleware order/no-bypass on the Hono app, one
// level above the pure-function unit tests (jwtGuard/rateLimiter/corsGuard).

let home: string
const savedHome = process.env.DEV_TEAM_DASHBOARD_HOME
const savedJwtSecret = process.env.DASHBOARD_JWT_SECRET

async function freshApp() {
  return createApp(createRegistryContext({ defaultRoot: null }))
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'security-integration-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  delete process.env.DASHBOARD_JWT_SECRET
  __resetRateLimitBuckets()
})

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
  if (savedHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = savedHome
  if (savedJwtSecret === undefined) delete process.env.DASHBOARD_JWT_SECRET
  else process.env.DASHBOARD_JWT_SECRET = savedJwtSecret
})

describe('JWT auth — cross-cutting on the Hono app', () => {
  test('TC-A01: no secret configured → unaffected, no 401', async () => {
    const app = await freshApp()
    const res = await app.request('/api/projects')
    expect(res.status).not.toBe(401)
  })

  test('TC-A03: secret configured + missing Authorization → 401 (not swallowed into 500)', async () => {
    process.env.DASHBOARD_JWT_SECRET = 'topsecret'
    const app = await freshApp()
    const res = await app.request('/api/projects')
    expect(res.status).toBe(401)
  })

  test('TC-A04: secret configured + valid token → passes through', async () => {
    process.env.DASHBOARD_JWT_SECRET = 'topsecret'
    const app = await freshApp()
    const token = await sign({ sub: 'admin' }, 'topsecret', 'HS256')
    const res = await app.request('/api/projects', { headers: { Authorization: `Bearer ${token}` } })
    expect(res.status).not.toBe(401)
  })

  test('TC-A09: alg:none forged token → 401 via onError HTTPException handling', async () => {
    process.env.DASHBOARD_JWT_SECRET = 'topsecret'
    const app = await freshApp()
    const encode = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url')
    const forged = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: 'admin' })}.`
    const res = await app.request('/api/projects', { headers: { Authorization: `Bearer ${forged}` } })
    expect(res.status).toBe(401)
  })
})

describe('Rate limit — cross-cutting on the Hono app', () => {
  test('TC-B01: disabled by default → no 429 under burst', async () => {
    const app = await freshApp()
    for (let i = 0; i < 20; i++) {
      const res = await app.request('/api/projects')
      expect(res.status).not.toBe(429)
    }
  })

  test('TC-B02/B03: exceeding max → 429 with Retry-After', async () => {
    saveSecurityConfig({
      rateLimit: { enabled: true, windowMs: 60_000, max: 2, routes: [] },
      cors: { enabled: false, allowedOrigins: [], allowCredentials: false },
    })
    const app = await freshApp()
    const headers = { 'x-dtd-client-ip': '10.0.0.1' }
    expect((await app.request('/api/projects', { headers })).status).not.toBe(429)
    expect((await app.request('/api/projects', { headers })).status).not.toBe(429)
    const blocked = await app.request('/api/projects', { headers })
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBeTruthy()
  })

  test('TC-B04: independent thresholds per route-group', async () => {
    saveSecurityConfig({
      rateLimit: {
        enabled: true,
        windowMs: 60_000,
        max: 100,
        routes: [{ pattern: '/api/projects', windowMs: 60_000, max: 1 }],
      },
      cors: { enabled: false, allowedOrigins: [], allowCredentials: false },
    })
    const app = await freshApp()
    const headers = { 'x-dtd-client-ip': '10.0.0.2' }
    expect((await app.request('/api/projects', { headers })).status).not.toBe(429)
    expect((await app.request('/api/projects', { headers })).status).toBe(429)
    // Unrelated route group still uses the higher default threshold.
    expect((await app.request('/api/pipeline-config', { headers })).status).not.toBe(429)
  })

  test('TC-B05: separate clients tracked independently', async () => {
    saveSecurityConfig({
      rateLimit: { enabled: true, windowMs: 60_000, max: 1, routes: [] },
      cors: { enabled: false, allowedOrigins: [], allowCredentials: false },
    })
    const app = await freshApp()
    expect((await app.request('/api/projects', { headers: { 'x-dtd-client-ip': 'client-a' } })).status).not.toBe(429)
    expect((await app.request('/api/projects', { headers: { 'x-dtd-client-ip': 'client-a' } })).status).toBe(429)
    expect((await app.request('/api/projects', { headers: { 'x-dtd-client-ip': 'client-b' } })).status).not.toBe(429)
  })
})

describe('CORS — cross-cutting on the Hono app', () => {
  test('TC-C01: disabled by default → no Allow-Origin for cross-origin request', async () => {
    const app = await freshApp()
    const res = await app.request('/api/projects', { headers: { Origin: 'https://external-site.example' } })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('TC-C02/C03: only allowlisted origin gets Allow-Origin', async () => {
    saveSecurityConfig({
      rateLimit: { enabled: false, windowMs: 60_000, max: 120, routes: [] },
      cors: { enabled: true, allowedOrigins: ['https://allowed.example'], allowCredentials: false },
    })
    const app = await freshApp()
    const ok = await app.request('/api/projects', { headers: { Origin: 'https://allowed.example' } })
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://allowed.example')

    const denied = await app.request('/api/projects', { headers: { Origin: 'https://not-allowed.example' } })
    expect(denied.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('TC-C05: preflight OPTIONS not blocked by JWT even when both are enabled', async () => {
    process.env.DASHBOARD_JWT_SECRET = 'topsecret'
    saveSecurityConfig({
      rateLimit: { enabled: false, windowMs: 60_000, max: 120, routes: [] },
      cors: { enabled: true, allowedOrigins: ['https://allowed.example'], allowCredentials: false },
    })
    const app = await freshApp()
    const res = await app.request('/api/projects', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://allowed.example',
        'Access-Control-Request-Method': 'GET',
      },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://allowed.example')
  })

  test('TC-C06: allowCredentials → Allow-Credentials + specific (non-wildcard) origin', async () => {
    saveSecurityConfig({
      rateLimit: { enabled: false, windowMs: 60_000, max: 120, routes: [] },
      cors: { enabled: true, allowedOrigins: ['https://allowed.example'], allowCredentials: true },
    })
    const app = await freshApp()
    const res = await app.request('/api/projects', { headers: { Origin: 'https://allowed.example' } })
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
    expect(res.headers.get('access-control-allow-origin')).toBe('https://allowed.example')
  })

  test('TC-C07: allowedOrigins empty despite enabled=true → treated as off', async () => {
    saveSecurityConfig({
      rateLimit: { enabled: false, windowMs: 60_000, max: 120, routes: [] },
      cors: { enabled: true, allowedOrigins: [], allowCredentials: false },
    })
    const app = await freshApp()
    const res = await app.request('/api/projects', { headers: { Origin: 'https://allowed.example' } })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('TC-D01/D02: all 3 middleware together, no bypass', () => {
  test('unauthenticated request still rejected when all 3 are enabled', async () => {
    process.env.DASHBOARD_JWT_SECRET = 'topsecret'
    saveSecurityConfig({
      rateLimit: { enabled: true, windowMs: 60_000, max: 100, routes: [] },
      cors: { enabled: true, allowedOrigins: ['https://allowed.example'], allowCredentials: false },
    })
    const app = await freshApp()
    const res = await app.request('/api/projects', { headers: { 'x-dtd-client-ip': 'client-d' } })
    expect(res.status).toBe(401)
  })

  test('fully valid request succeeds with all 3 enabled', async () => {
    process.env.DASHBOARD_JWT_SECRET = 'topsecret'
    saveSecurityConfig({
      rateLimit: { enabled: true, windowMs: 60_000, max: 100, routes: [] },
      cors: { enabled: true, allowedOrigins: ['https://allowed.example'], allowCredentials: false },
    })
    const app = await freshApp()
    const token = await sign({ sub: 'admin' }, 'topsecret', 'HS256')
    const res = await app.request('/api/projects', {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'https://allowed.example',
        'x-dtd-client-ip': 'client-e',
      },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://allowed.example')
  })
})
