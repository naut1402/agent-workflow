import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RECOVERY_SETTINGS,
  parseRecoverySettings,
  resolveRecoveryBackoffMs,
  resolveRecoveryMaxAttempts,
  resolveRecoveryPollIntervalMs,
} from '@/features/settings/schemas/recovery'

describe('parseRecoverySettings', () => {
  it('returns default for invalid input', () => {
    expect(parseRecoverySettings(null)).toEqual(DEFAULT_RECOVERY_SETTINGS)
    expect(parseRecoverySettings('x')).toEqual(DEFAULT_RECOVERY_SETTINGS)
  })

  it('parses partial overrides, filling the rest with defaults', () => {
    expect(parseRecoverySettings({ enabled: false, maxAttempts: 5 })).toEqual({
      ...DEFAULT_RECOVERY_SETTINGS,
      enabled: false,
      maxAttempts: 5,
    })
  })

  it('keeps a custom backoff schedule', () => {
    expect(parseRecoverySettings({ enabled: true, backoffMs: [1_000, 2_000] }).backoffMs).toEqual([1_000, 2_000])
  })
})

describe('resolveRecoveryMaxAttempts', () => {
  it('defaults to 3', () => {
    expect(resolveRecoveryMaxAttempts({})).toBe(3)
    expect(resolveRecoveryMaxAttempts(undefined)).toBe(3)
  })

  it('keeps a positive override', () => {
    expect(resolveRecoveryMaxAttempts({ maxAttempts: 7 })).toBe(7)
  })
})

describe('resolveRecoveryBackoffMs', () => {
  it('defaults to [5000, 15000, 45000]', () => {
    expect(resolveRecoveryBackoffMs({})).toEqual([5_000, 15_000, 45_000])
  })

  it('keeps a non-empty override', () => {
    expect(resolveRecoveryBackoffMs({ backoffMs: [1_000] })).toEqual([1_000])
  })
})

describe('resolveRecoveryPollIntervalMs', () => {
  it('defaults to 30000', () => {
    expect(resolveRecoveryPollIntervalMs({})).toBe(30_000)
  })

  it('keeps a positive override', () => {
    expect(resolveRecoveryPollIntervalMs({ pollIntervalMs: 5_000 })).toBe(5_000)
  })
})
