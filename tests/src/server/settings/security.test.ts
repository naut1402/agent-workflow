import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  loadSecurityConfig,
  saveSecurityConfig,
  dashboardSettingsFile,
} from '../../../../src/features/settings/business/dashboardSettings'

let home: string
const savedHome = process.env.DEV_TEAM_DASHBOARD_HOME

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'security-config-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
  if (savedHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = savedHome
})

describe('security config', () => {
  test('defaults to OFF when settings.json is missing', () => {
    const cfg = loadSecurityConfig()
    expect(cfg.rateLimit).toEqual({ enabled: false, windowMs: 60_000, max: 120, routes: [] })
    expect(cfg.cors).toEqual({ enabled: false, allowedOrigins: [], allowCredentials: false })
  })

  test('save round-trips into settings.json', () => {
    const saved = saveSecurityConfig({
      rateLimit: { enabled: true, windowMs: 30_000, max: 50, routes: [{ pattern: '/api/runner', windowMs: 10_000, max: 5 }] },
      cors: { enabled: true, allowedOrigins: ['https://allowed.example'], allowCredentials: true },
    })
    expect(saved.rateLimit.enabled).toBe(true)
    expect(saved.cors.allowedOrigins).toEqual(['https://allowed.example'])
    expect(fs.existsSync(dashboardSettingsFile())).toBe(true)
    const disk = JSON.parse(fs.readFileSync(dashboardSettingsFile(), 'utf8'))
    expect(disk.security.rateLimit.enabled).toBe(true)
    expect(loadSecurityConfig()).toEqual(saved)
  })

  test('invalid shape on disk falls back to defaults', () => {
    fs.mkdirSync(home, { recursive: true })
    fs.writeFileSync(dashboardSettingsFile(), JSON.stringify({ security: { rateLimit: { max: -1 } } }), 'utf8')
    const cfg = loadSecurityConfig()
    expect(cfg.rateLimit).toEqual({ enabled: false, windowMs: 60_000, max: 120, routes: [] })
  })
})
