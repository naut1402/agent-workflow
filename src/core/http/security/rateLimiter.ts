import type { MiddlewareHandler } from 'hono'
import type { HonoEnv } from '../types.js'
import type { RateLimitConfig } from '../../../features/settings/schemas/security.js'

interface Bucket {
  count: number
  resetAt: number
}
const buckets = new Map<string, Bucket>()
const SWEEP_THRESHOLD = 10_000

function sweepExpired(now: number): void {
  if (buckets.size < SWEEP_THRESHOLD) return
  for (const [key, b] of buckets) if (now >= b.resetAt) buckets.delete(key)
}

export function matchRateLimitGroup(
  path: string,
  config: RateLimitConfig,
): { windowMs: number; max: number; groupId: string } {
  let best: { pattern: string; windowMs: number; max: number } | null = null
  for (const r of config.routes) {
    if (path.startsWith(r.pattern) && (!best || r.pattern.length > best.pattern.length)) best = r
  }
  if (best) return { windowMs: best.windowMs, max: best.max, groupId: best.pattern }
  return { windowMs: config.windowMs, max: config.max, groupId: 'default' }
}

export function checkAndConsume(
  key: string,
  windowMs: number,
  max: number,
  now: number,
): { allowed: boolean; retryAfterMs: number } {
  sweepExpired(now)
  const b = buckets.get(key)
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfterMs: 0 }
  }
  if (b.count >= max) return { allowed: false, retryAfterMs: b.resetAt - now }
  b.count += 1
  return { allowed: true, retryAfterMs: 0 }
}

export function resolveClientIp(req: { socket?: { remoteAddress?: string | null } }): string {
  return req.socket?.remoteAddress || 'unknown'
}

/** Test-only reset — tránh state rò giữa test case (`buckets` là module-level singleton). */
export function __resetRateLimitBuckets(): void {
  buckets.clear()
}

export function createRateLimitMiddleware(
  loadConfig: () => RateLimitConfig,
): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const config = loadConfig()
    if (!config.enabled) return next()
    const ip = c.req.header('x-dtd-client-ip') || 'unknown'
    const { windowMs, max, groupId } = matchRateLimitGroup(c.req.path, config)
    const { allowed, retryAfterMs } = checkAndConsume(`${groupId}:${ip}`, windowMs, max, Date.now())
    if (!allowed) {
      c.header('Retry-After', String(Math.ceil(retryAfterMs / 1000)))
      return c.json({ error: 'rate limit exceeded' }, 429)
    }
    return next()
  }
}
