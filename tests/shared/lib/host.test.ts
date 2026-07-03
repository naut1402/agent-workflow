import { describe, expect, it } from 'vitest'
import { isLocalDashboardHost } from '../../../src/shared/lib/host'

describe('isLocalDashboardHost', () => {
  it('accepts localhost variants', () => {
    expect(isLocalDashboardHost('localhost')).toBe(true)
    expect(isLocalDashboardHost('127.0.0.1')).toBe(true)
    expect(isLocalDashboardHost('[::1]')).toBe(true)
    expect(isLocalDashboardHost('::1')).toBe(true)
  })

  it('rejects remote hostnames', () => {
    expect(isLocalDashboardHost('app.example.com')).toBe(false)
    expect(isLocalDashboardHost('192.168.1.10')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isLocalDashboardHost('LOCALHOST')).toBe(true)
  })
})
