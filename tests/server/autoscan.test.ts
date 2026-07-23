import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { browseDirectory } from '../../server/fsBrowse'
import { loadAutoscanConfig, saveAutoscanConfig, autoscanFile } from '../../server/autoscan/config'
import { runAutoscan } from '../../server/autoscan/scan'
import { add, list, createRegistryContext } from '../../server/registry'
import { createApp } from '../../server/http/app'

let home: string
let workspaceParent: string
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved.HOME = process.env.DEV_TEAM_DASHBOARD_HOME
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'autoscan-home-'))
  workspaceParent = fs.mkdtempSync(path.join(os.tmpdir(), 'autoscan-ws-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(workspaceParent, { recursive: true, force: true })
  if (saved.HOME === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = saved.HOME
})

describe('autoscan config', () => {
  test('load default when missing; save round-trips', () => {
    const cfg = loadAutoscanConfig()
    expect(cfg.enabled).toBe(false)
    expect(cfg.whitelist).toEqual([])
    const savedCfg = saveAutoscanConfig({
      enabled: true,
      whitelist: [workspaceParent, workspaceParent], // dedupe
      intervalMs: 30_000,
    })
    expect(savedCfg.whitelist).toEqual([workspaceParent])
    expect(fs.existsSync(autoscanFile())).toBe(true)
    expect(loadAutoscanConfig()).toEqual(savedCfg)
  })
})

describe('runAutoscan', () => {
  test('discovers child project roots and registers them', async () => {
    const proj = path.join(workspaceParent, 'my-app')
    fs.mkdirSync(path.join(proj, '.dev-team-agent'), { recursive: true })

    const report = await runAutoscan([workspaceParent])
    expect(report.added.length).toBe(1)
    expect(report.added[0].name).toBe('my-app')
    expect(list().projects).toHaveLength(1)

    const again = await runAutoscan([workspaceParent])
    expect(again.added.length).toBe(0)
    expect(again.existing.length).toBe(1)
  })

  test('skips relative whitelist entries', async () => {
    const report = await runAutoscan(['relative/path'])
    expect(report.skipped[0]?.reason).toContain('absolute')
    expect(report.scanned).toBe(0)
  })
})

describe('browseDirectory', () => {
  test('lists subdirectories of an absolute path', async () => {
    const child = path.join(workspaceParent, 'subdir')
    fs.mkdirSync(child)
    fs.writeFileSync(path.join(workspaceParent, 'file.txt'), 'x')
    const outcome = await browseDirectory(workspaceParent)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.entries.some((e) => e.name === 'subdir')).toBe(true)
    expect(outcome.result.entries.every((e) => e.isDirectory)).toBe(true)
  })

  test('rejects relative paths', async () => {
    const outcome = await browseDirectory('not/absolute')
    expect(outcome.ok).toBe(false)
  })
})

describe('HTTP autoscan + fs browse', () => {
  test('GET/PUT /api/autoscan and POST /api/autoscan/run', async () => {
    const proj = path.join(workspaceParent, 'http-app')
    fs.mkdirSync(path.join(proj, '.dev-team-agent'), { recursive: true })

    const ctx = createRegistryContext({ defaultRoot: null })
    const app = createApp(ctx)

    const get0 = await app.request('/api/autoscan')
    expect(get0.status).toBe(200)
    expect((await get0.json()).config.enabled).toBe(false)

    const put = await app.request('/api/autoscan', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, whitelist: [workspaceParent] }),
    })
    expect(put.status).toBe(200)
    expect((await put.json()).config.enabled).toBe(true)

    const run = await app.request('/api/autoscan/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(run.status).toBe(200)
    const body = await run.json()
    expect(body.report.added.length).toBe(1)
    expect(add({ path: proj }).ok).toBe(true) // already registered → existing
  })

  test('GET /api/fs/browse', async () => {
    const child = path.join(workspaceParent, 'visible')
    fs.mkdirSync(child)
    const ctx = createRegistryContext({ defaultRoot: null })
    const app = createApp(ctx)
    const res = await app.request(`/api/fs/browse?path=${encodeURIComponent(workspaceParent)}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.entries.some((e: { name: string }) => e.name === 'visible')).toBe(true)
  })
})
