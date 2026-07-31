import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  loadGithubTokensConfig,
  saveGithubTokensConfig,
  dashboardSettingsFile,
  saveAutoscanConfig,
} from '../../../../src/features/settings/business/autoscan/config'
import { createRegistryContext } from '../../../../src/core/registry'
import { createApp } from '../../../../src/core/http/app'
import { fetchGithubIssue } from '../../../../src/features/monitor/business/github/issue'

let home: string
const saved: Record<string, string | undefined> = {}
const originalFetch = globalThis.fetch

beforeEach(() => {
  saved.HOME = process.env.DEV_TEAM_DASHBOARD_HOME
  saved.TOKEN = process.env.GITHUB_TOKEN
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-tokens-home-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  delete process.env.GITHUB_TOKEN
})

afterEach(() => {
  globalThis.fetch = originalFetch
  fs.rmSync(home, { recursive: true, force: true })
  if (saved.HOME === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = saved.HOME
  if (saved.TOKEN === undefined) delete process.env.GITHUB_TOKEN
  else process.env.GITHUB_TOKEN = saved.TOKEN
})

describe('github tokens config', () => {
  test('load default empty; save round-trips and preserves autoscan', () => {
    saveAutoscanConfig({ enabled: true, whitelist: ['/ws'], intervalMs: 60_000 })
    expect(loadGithubTokensConfig().repos).toEqual([])

    const savedCfg = saveGithubTokensConfig({
      repos: [
        { repo: 'Owner/App', token: 'ghp_a' },
        { repo: 'owner/app', token: 'ghp_b' },
      ],
    })
    expect(savedCfg.repos).toEqual([{ repo: 'owner/app', token: 'ghp_b' }])
    const disk = JSON.parse(fs.readFileSync(dashboardSettingsFile(), 'utf8'))
    expect(disk.githubTokens.repos[0].token).toBe('ghp_b')
    expect(disk.autoscan.enabled).toBe(true)
  })
})

describe('GET/PUT /api/github/tokens', () => {
  test('round-trips via Hono', async () => {
    const app = await createApp(createRegistryContext())
    const put = await app.request('/api/github/tokens', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repos: [{ repo: 'acme/private', token: 'tok' }] }),
    })
    expect(put.status).toBe(200)
    const putBody = await put.json()
    expect(putBody.config.repos).toEqual([{ repo: 'acme/private', token: 'tok' }])

    const get = await app.request('/api/github/tokens')
    expect(get.status).toBe(200)
    const getBody = await get.json()
    expect(getBody.config.repos).toEqual([{ repo: 'acme/private', token: 'tok' }])
  })
})

describe('fetchGithubIssue with per-repo token', () => {
  test('Authorization uses dashboard token for matching repo', async () => {
    saveGithubTokensConfig({
      repos: [{ repo: 'o/r', token: 'repo-pat' }],
    })
    process.env.GITHUB_TOKEN = 'env-pat'

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer repo-pat')
      return new Response(
        JSON.stringify({
          number: 1,
          title: 'T',
          body: null,
          labels: [],
          html_url: 'https://github.com/o/r/issues/1',
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const result = await fetchGithubIssue('https://github.com/o/r/issues/1')
    expect(result.ok).toBe(true)
  })
})
