import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DASHBOARD_SETTINGS,
  parseDashboardSettings,
  resolveAutoscanFromDashboard,
  resolveGithubTokensFromDashboard,
} from '@/features/settings/schemas/dashboardSettings'

describe('parseDashboardSettings', () => {
  it('returns default for invalid input', () => {
    expect(parseDashboardSettings(null).autoscan).toEqual(DEFAULT_DASHBOARD_SETTINGS.autoscan)
    expect(parseDashboardSettings('x').autoscan?.enabled).toBe(false)
    expect(parseDashboardSettings(null).githubTokens).toEqual({ repos: [] })
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

  it('nests githubTokens under global settings', () => {
    const parsed = parseDashboardSettings({
      githubTokens: { repos: [{ repo: 'Acme/App', token: 'ghp_x' }] },
    })
    expect(parsed.githubTokens).toEqual({
      repos: [{ repo: 'acme/app', token: 'ghp_x' }],
    })
  })
})

describe('resolveAutoscanFromDashboard', () => {
  it('falls back to defaults', () => {
    expect(resolveAutoscanFromDashboard({}).enabled).toBe(false)
    expect(resolveAutoscanFromDashboard(undefined).intervalMs).toBe(60_000)
  })
})

describe('resolveGithubTokensFromDashboard', () => {
  it('falls back to empty repos', () => {
    expect(resolveGithubTokensFromDashboard({}).repos).toEqual([])
    expect(resolveGithubTokensFromDashboard(undefined).repos).toEqual([])
  })
})
