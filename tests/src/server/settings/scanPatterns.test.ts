import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  dashboardSettingsFile,
  loadAutoscanConfig,
  loadScanPatternsConfig,
  saveAutoscanConfig,
  saveScanPatternsConfig,
} from '../../../../src/features/settings/business/dashboardSettings'

let home: string
const savedHome = process.env.DEV_TEAM_DASHBOARD_HOME

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-patterns-config-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
  if (savedHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = savedHome
})

const writeSettings = (data: unknown) => {
  fs.mkdirSync(home, { recursive: true })
  fs.writeFileSync(dashboardSettingsFile(), JSON.stringify(data), 'utf8')
}

describe('scan patterns config', () => {
  test('defaults to three empty lists when settings.json is missing', () => {
    expect(loadScanPatternsConfig()).toEqual({ agents: [], skills: [], rules: [] })
  })

  test('save round-trips into settings.json', () => {
    const saved = saveScanPatternsConfig({
      agents: ['.agents/*.md'],
      skills: ['packages/*/skills'],
      rules: ['docs/rules', '.claude/**/rules'],
    })
    expect(saved.rules).toEqual(['docs/rules', '.claude/**/rules'])
    const disk = JSON.parse(fs.readFileSync(dashboardSettingsFile(), 'utf8'))
    expect(disk.scanPatterns.agents).toEqual(['.agents/*.md'])
    expect(loadScanPatternsConfig()).toEqual(saved)
  })

  test('kinds stay independent across saves', () => {
    saveScanPatternsConfig({ agents: ['a1'], skills: [], rules: [] })
    const saved = saveScanPatternsConfig({ agents: ['a1'], skills: ['s1'], rules: [] })
    expect(saved).toEqual({ agents: ['a1'], skills: ['s1'], rules: [] })
  })

  test('saving another settings block keeps the patterns', () => {
    saveScanPatternsConfig({ agents: ['.agents'], skills: [], rules: [] })
    saveAutoscanConfig({ enabled: true, whitelist: ['/ws'] })
    expect(loadScanPatternsConfig().agents).toEqual(['.agents'])
    expect(loadAutoscanConfig().enabled).toBe(true)
  })

  test('saving patterns keeps other settings blocks', () => {
    saveAutoscanConfig({ enabled: true, whitelist: ['/ws'] })
    saveScanPatternsConfig({ agents: ['.agents'], skills: [], rules: [] })
    expect(loadAutoscanConfig()).toMatchObject({ enabled: true, whitelist: ['/ws'] })
  })

  test('a settings.json written before this feature loads as empty', () => {
    writeSettings({ autoscan: { enabled: true, whitelist: [] } })
    expect(loadScanPatternsConfig()).toEqual({ agents: [], skills: [], rules: [] })
    expect(loadAutoscanConfig().enabled).toBe(true)
  })

  test('unsafe or junk entries on disk are dropped without losing the good ones', () => {
    writeSettings({
      scanPatterns: {
        agents: ['/etc', '../up', '~/x', 7, './tools/'],
        skills: 'not-an-array',
        rules: ['docs/rules', 'docs/rules'],
      },
    })
    expect(loadScanPatternsConfig()).toEqual({
      agents: ['tools'],
      skills: [],
      rules: ['docs/rules'],
    })
  })

  test('a broken settings.json falls back to empty patterns', () => {
    fs.mkdirSync(home, { recursive: true })
    fs.writeFileSync(dashboardSettingsFile(), '{ not json', 'utf8')
    expect(loadScanPatternsConfig()).toEqual({ agents: [], skills: [], rules: [] })
  })
})
