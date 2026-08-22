import { jwt, verify } from 'hono/jwt'
import type { MiddlewareHandler } from 'hono'
import type { HonoEnv } from '../types.js'

const ALG = 'HS256' as const

export function hasJwtSecret(): boolean {
  return Boolean(process.env.DASHBOARD_JWT_SECRET)
}

/** No-op khi chưa cấu hình secret (degrade-by-default). */
export function createJwtMiddleware(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const secret = process.env.DASHBOARD_JWT_SECRET
    if (!secret) return next()
    return jwt({ secret, alg: ALG })(c, next)
  }
}

export type JwtCheckResult = { ok: true } | { ok: false; status: 401; error: string }

/** Guard thủ công cho nhánh /api/knowledge (ngoài Hono) — dùng lại `verify()` của hono/jwt. */
export async function verifyJwtHeader(authHeader: string | undefined): Promise<JwtCheckResult> {
  const secret = process.env.DASHBOARD_JWT_SECRET
  if (!secret) return { ok: true }
  if (!authHeader) return { ok: false, status: 401, error: 'no authorization included in request' }
  const parts = authHeader.split(/\s+/)
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return { ok: false, status: 401, error: 'invalid credentials structure' }
  }
  try {
    await verify(parts[1], secret, ALG)
    return { ok: true }
  } catch {
    return { ok: false, status: 401, error: 'invalid token' }
  }
}
