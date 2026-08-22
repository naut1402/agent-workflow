import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { sign } from 'hono/jwt'
import { Hono } from 'hono'
import { hasJwtSecret, createJwtMiddleware, verifyJwtHeader } from '../../../../../src/core/http/security/jwtGuard'

const savedSecret = process.env.DASHBOARD_JWT_SECRET

beforeEach(() => {
  delete process.env.DASHBOARD_JWT_SECRET
})

afterEach(() => {
  if (savedSecret === undefined) delete process.env.DASHBOARD_JWT_SECRET
  else process.env.DASHBOARD_JWT_SECRET = savedSecret
})

function makeApp() {
  const app = new Hono()
  app.use('/*', createJwtMiddleware())
  app.get('/ping', (c) => c.json({ ok: true }))
  return app
}

describe('hasJwtSecret', () => {
  test('false when unset or empty', () => {
    expect(hasJwtSecret()).toBe(false)
    process.env.DASHBOARD_JWT_SECRET = ''
    expect(hasJwtSecret()).toBe(false)
  })

  test('true when set to a non-empty value', () => {
    process.env.DASHBOARD_JWT_SECRET = 'topsecret'
    expect(hasJwtSecret()).toBe(true)
  })
})

describe('createJwtMiddleware', () => {
  test('no secret configured → passes through without Authorization', async () => {
    const app = makeApp()
    const res = await app.request('/ping')
    expect(res.status).toBe(200)
  })

  test('secret configured + missing Authorization → 401', async () => {
    process.env.DASHBOARD_JWT_SECRET = 'topsecret'
    const app = makeApp()
    const res = await app.request('/ping')
    expect(res.status).toBe(401)
  })

  test('secret configured + valid token → 200', async () => {
    process.env.DASHBOARD_JWT_SECRET = 'topsecret'
    const app = makeApp()
    const token = await sign({ sub: 'admin' }, 'topsecret', 'HS256')
    const res = await app.request('/ping', { headers: { Authorization: `Bearer ${token}` } })
    expect(res.status).toBe(200)
  })

  test('token signed with wrong secret → 401', async () => {
    process.env.DASHBOARD_JWT_SECRET = 'topsecret'
    const app = makeApp()
    const token = await sign({ sub: 'admin' }, 'wrong-secret', 'HS256')
    const res = await app.request('/ping', { headers: { Authorization: `Bearer ${token}` } })
    expect(res.status).toBe(401)
  })
})

describe('verifyJwtHeader', () => {
  test('no secret configured → ok regardless of header', async () => {
    expect(await verifyJwtHeader(undefined)).toEqual({ ok: true })
  })

  test('secret configured + missing header → 401', async () => {
    process.env.DASHBOARD_JWT_SECRET = 'topsecret'
    const result = await verifyJwtHeader(undefined)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })

  test('malformed Authorization header variants → 401', async () => {
    process.env.DASHBOARD_JWT_SECRET = 'topsecret'
    const token = await sign({ sub: 'admin' }, 'topsecret', 'HS256')
    for (const header of [token, 'Bearer', 'Basic xxx']) {
      const result = await verifyJwtHeader(header)
      expect(result.ok).toBe(false)
    }
  })

  test('valid token → ok', async () => {
    process.env.DASHBOARD_JWT_SECRET = 'topsecret'
    const token = await sign({ sub: 'admin' }, 'topsecret', 'HS256')
    expect(await verifyJwtHeader(`Bearer ${token}`)).toEqual({ ok: true })
  })

  test('token without exp claim is still accepted', async () => {
    process.env.DASHBOARD_JWT_SECRET = 'topsecret'
    const token = await sign({ sub: 'admin' }, 'topsecret', 'HS256')
    expect(await verifyJwtHeader(`Bearer ${token}`)).toEqual({ ok: true })
  })

  test('expired token → 401', async () => {
    process.env.DASHBOARD_JWT_SECRET = 'topsecret'
    const token = await sign({ sub: 'admin', exp: Math.floor(Date.now() / 1000) - 60 }, 'topsecret', 'HS256')
    const result = await verifyJwtHeader(`Bearer ${token}`)
    expect(result.ok).toBe(false)
  })

  test('alg:none unsigned token → 401', async () => {
    process.env.DASHBOARD_JWT_SECRET = 'topsecret'
    const encode = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url')
    const forged = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: 'admin' })}.`
    const result = await verifyJwtHeader(`Bearer ${forged}`)
    expect(result.ok).toBe(false)
  })
})
