import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DASHBOARD_SETTINGS,
  parseDashboardSettings,
  resolveAutoscanFromDashboard,
} from '../../../shared/schemas/dashboardSettings'

describe('parseDashboardSettings', () => {
  it('returns default for invalid input', () => {
    expect(parseDashboardSettings(null).autoscan).toEqual(DEFAULT_DASHBOARD_SETTINGS.autoscan)
    expect(parseDashboardSettings('x').autoscan?.enabled).toBe(false)
  })

  it('nests autoscan under global settings', () => {
    const parsed = parseDashboardSettings({
      autoscan: { enabled: true, whitelist: ['/ws'], intervalMs: 45_000 },
    })
    expect(parsed.autoscan).toEqual({
      enabled: true,
      whitelist: ['/ws'],
      intervalMs: 45_000,
    })
  })
})

describe('resolveAutoscanFromDashboard', () => {
  it('falls back to defaults', () => {
    expect(resolveAutoscanFromDashboard({}).enabled).toBe(false)
    expect(resolveAutoscanFromDashboard(undefined).intervalMs).toBe(60_000)
  })
})
