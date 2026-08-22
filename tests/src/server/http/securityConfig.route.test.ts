import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sign } from 'hono/jwt'
import { createApp } from '../../../../src/api/apiServer'
import { createRegistryContext } from '../../../../src/core/registry'
import { loadSecurityConfig } from '../../../../src/features/settings/business/dashboardSettings'

let home: string
const savedHome = process.env.DEV_TEAM_DASHBOARD_HOME
const savedJwtSecret = process.env.DASHBOARD_JWT_SECRET

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'security-config-http-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  delete process.env.DASHBOARD_JWT_SECRET
})

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
  if (savedHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = savedHome
  if (savedJwtSecret === undefined) delete process.env.DASHBOARD_JWT_SECRET
  else process.env.DASHBOARD_JWT_SECRET = savedJwtSecret
})

describe('HTTP security-config', () => {
  test('GET defaults with jwtEnabled=false, then PUT round-trips', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))

    const get0 = await app.request('/api/security-config')
    expect(get0.status).toBe(200)
    const body0 = await get0.json()
    expect(body0.jwtEnabled).toBe(false)
    expect(body0.config.rateLimit.enabled).toBe(false)
    expect(body0.config.cors.enabled).toBe(false)

    const put = await app.request('/api/security-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rateLimit: { enabled: true, windowMs: 30_000, max: 10, routes: [] },
        cors: { enabled: true, allowedOrigins: ['https://allowed.example'], allowCredentials: false },
      }),
    })
    expect(put.status).toBe(200)
    const body1 = await put.json()
    expect(body1.config.rateLimit.enabled).toBe(true)
    expect(body1.config.cors.allowedOrigins).toEqual(['https://allowed.example'])

    expect(loadSecurityConfig().rateLimit.enabled).toBe(true)

    const get1 = await app.request('/api/security-config')
    expect((await get1.json()).config.rateLimit.enabled).toBe(true)
  })

  test('jwtEnabled reflects DASHBOARD_JWT_SECRET presence', async () => {
    process.env.DASHBOARD_JWT_SECRET = 'topsecret'
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    const token = await sign({ sub: 'admin' }, 'topsecret', 'HS256')
    const res = await app.request('/api/security-config', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    expect((await res.json()).jwtEnabled).toBe(true)
  })
})
