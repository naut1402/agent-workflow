import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AUTOSCAN_CONFIG,
  parseAutoscanConfig,
  resolveAutoscanIntervalMs,
} from '../../../shared/schemas/autoscan'

describe('parseAutoscanConfig', () => {
  it('returns default for invalid input', () => {
    expect(parseAutoscanConfig(null)).toEqual(DEFAULT_AUTOSCAN_CONFIG)
    expect(parseAutoscanConfig('x')).toEqual(DEFAULT_AUTOSCAN_CONFIG)
  })

  it('parses enabled + whitelist', () => {
    expect(
      parseAutoscanConfig({ enabled: true, whitelist: ['/a', '/b'], intervalMs: 15_000 }),
    ).toEqual({
      enabled: true,
      whitelist: ['/a', '/b'],
      intervalMs: 15_000,
    })
  })
})

describe('resolveAutoscanIntervalMs', () => {
  it('defaults to 60000', () => {
    expect(resolveAutoscanIntervalMs({})).toBe(60_000)
    expect(resolveAutoscanIntervalMs(undefined)).toBe(60_000)
  })

  it('keeps positive interval', () => {
    expect(resolveAutoscanIntervalMs({ intervalMs: 12_000 })).toBe(12_000)
  })
})
