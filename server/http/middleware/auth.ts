import crypto from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import { AUTHORIZATION_HEADER, DEV_TEAM_TOKEN_HEADER } from '../../../shared/schemas/auth.js'
import { j } from '../respond.js'

function expectedToken(): string | null {
  const raw = process.env.DEV_TEAM_API_TOKEN
  const trimmed = raw?.trim() || ''
  return trimmed ? trimmed : null
}

function extractTokenFromAuthorization(value: string | null): string | null {
  if (!value) return null
  const m = /^Bearer\s+(.+)\s*$/.exec(value)
  return m ? m[1] : null
}

function extractRequestToken(c: Context): string | null {
  const bearer = extractTokenFromAuthorization(c.req.header(AUTHORIZATION_HEADER) || null)
  if (bearer) return bearer
  const raw = (c.req.header(DEV_TEAM_TOKEN_HEADER) || '').trim()
  return raw || null
}

function timingSafeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

export function createAuthMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const expected = expectedToken()
    if (!expected) return next()

    // Exact bypass for health.
    const pathname = new URL(c.req.url).pathname
    if (pathname === '/api/health') return next()

    const actual = extractRequestToken(c)
    if (!actual || !timingSafeEquals(actual, expected)) {
      return j(c as any, 401, { error: 'unauthorized' })
    }

    await next()
  }
}

