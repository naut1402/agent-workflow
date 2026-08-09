import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/api/apiServer.js'
import { createRegistryContext } from '../../../../src/core/registry.js'
import { invalidateLoggingPrefsCache } from '../../../../src/core/log/loggingPrefs.js'
import { appendLog } from '../../../../src/core/log/store.js'
import {
  loadLoggingConfig,
  saveLoggingConfig,
} from '../../../../src/features/settings/business/dashboardSettings.js'

let home: string
const savedHome = process.env.DEV_TEAM_DASHBOARD_HOME

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'logging-config-http-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  invalidateLoggingPrefsCache()
})

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
  if (savedHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = savedHome
  invalidateLoggingPrefsCache()
})

describe('HTTP logging-config + gated log read', () => {
  test('GET defaults then PUT round-trips logging prefs', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))

    const get0 = await app.request('/api/logging-config')
    expect(get0.status).toBe(200)
    expect(await get0.json()).toEqual({
      config: {
        showLogsTab: true,
        types: { audit: true, request: true, jobs: true, events: false },
      },
    })

    const put = await app.request('/api/logging-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        showLogsTab: false,
        types: { audit: false, request: true, jobs: false },
      }),
    })
    expect(put.status).toBe(200)
    expect(await put.json()).toEqual({
      config: {
        showLogsTab: false,
        types: { audit: false, request: true, jobs: false, events: false },
      },
    })

    expect(loadLoggingConfig()).toEqual({
      showLogsTab: false,
      types: { audit: false, request: true, jobs: false, events: false },
    })

    const get1 = await app.request('/api/logging-config')
    expect((await get1.json()).config.showLogsTab).toBe(false)
  })

  test('GET /api/logs returns empty when type disabled', async () => {
    saveLoggingConfig({
      showLogsTab: true,
      types: { audit: true, request: true, jobs: true, events: false },
    })
    invalidateLoggingPrefsCache()
    await appendLog({
      type: 'audit',
      ts: Date.now(),
      iso: new Date().toISOString(),
      op: 'create',
      entity: 'project',
      identifier: 'visible-then-hidden',
      projectId: null,
    })

    saveLoggingConfig({
      showLogsTab: true,
      types: { audit: false, request: true, jobs: true, events: false },
    })
    invalidateLoggingPrefsCache()

    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    const res = await app.request('/api/logs?type=audit')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ entries: [] })
  })
})
