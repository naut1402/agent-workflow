import { beforeEach, describe, expect, test } from 'bun:test'
import {
  checkAndConsume,
  matchRateLimitGroup,
  __resetRateLimitBuckets,
} from '../../../../../src/core/http/security/rateLimiter'
import type { RateLimitConfig } from '../../../../../src/features/settings/schemas/security'

beforeEach(() => {
  __resetRateLimitBuckets()
})

describe('checkAndConsume', () => {
  test('allows requests under max within the window', () => {
    const now = 1_000_000
    expect(checkAndConsume('k1', 60_000, 3, now).allowed).toBe(true)
    expect(checkAndConsume('k1', 60_000, 3, now + 10).allowed).toBe(true)
    expect(checkAndConsume('k1', 60_000, 3, now + 20).allowed).toBe(true)
  })

  test('blocks the request once max is reached, with retryAfterMs', () => {
    const now = 1_000_000
    checkAndConsume('k2', 60_000, 2, now)
    checkAndConsume('k2', 60_000, 2, now + 10)
    const blocked = checkAndConsume('k2', 60_000, 2, now + 20)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBe(60_000 - 20)
  })

  test('resets after the window elapses', () => {
    const now = 1_000_000
    checkAndConsume('k3', 1_000, 1, now)
    expect(checkAndConsume('k3', 1_000, 1, now + 500).allowed).toBe(false)
    expect(checkAndConsume('k3', 1_000, 1, now + 1_000).allowed).toBe(true)
  })

  test('separate keys have independent buckets', () => {
    const now = 1_000_000
    checkAndConsume('clientA', 60_000, 1, now)
    expect(checkAndConsume('clientA', 60_000, 1, now + 1).allowed).toBe(false)
    expect(checkAndConsume('clientB', 60_000, 1, now + 1).allowed).toBe(true)
  })
})

describe('matchRateLimitGroup', () => {
  const config: RateLimitConfig = {
    enabled: true,
    windowMs: 60_000,
    max: 100,
    routes: [
      { pattern: '/api/runner', windowMs: 10_000, max: 5 },
      { pattern: '/api/runner/providers', windowMs: 5_000, max: 2 },
    ],
  }

  test('falls back to default group when no route matches', () => {
    expect(matchRateLimitGroup('/api/projects', config)).toEqual({ windowMs: 60_000, max: 100, groupId: 'default' })
  })

  test('picks the longest matching pattern', () => {
    expect(matchRateLimitGroup('/api/runner/providers/list', config)).toEqual({
      windowMs: 5_000,
      max: 2,
      groupId: '/api/runner/providers',
    })
    expect(matchRateLimitGroup('/api/runner/status', config)).toEqual({
      windowMs: 10_000,
      max: 5,
      groupId: '/api/runner',
    })
  })
})
