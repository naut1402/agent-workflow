import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/api/apiServer'
import { createRegistryContext } from '../../../../src/core/registry'
import { loadScanPatternsConfig } from '../../../../src/features/settings/business/dashboardSettings'

let home: string
const savedHome = process.env.DEV_TEAM_DASHBOARD_HOME

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-patterns-http-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
  if (savedHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = savedHome
})

const put = (app: Awaited<ReturnType<typeof createApp>>, body: unknown) =>
  app.request('/api/scan-patterns', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('HTTP scan-patterns', () => {
  test('GET defaults to three empty lists, then PUT round-trips', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))

    const get0 = await app.request('/api/scan-patterns')
    expect(get0.status).toBe(200)
    expect((await get0.json()).config).toEqual({ agents: [], skills: [], rules: [] })

    const res = await put(app, {
      agents: ['.agents/*.md'],
      skills: ['packages/*/skills'],
      rules: ['docs/rules'],
    })
    expect(res.status).toBe(200)
    expect((await res.json()).config).toEqual({
      agents: ['.agents/*.md'],
      skills: ['packages/*/skills'],
      rules: ['docs/rules'],
    })
    expect(loadScanPatternsConfig().skills).toEqual(['packages/*/skills'])

    const get1 = await app.request('/api/scan-patterns')
    expect((await get1.json()).config.agents).toEqual(['.agents/*.md'])
  })

  test('a PUT carrying one kind leaves the other two alone', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    await put(app, { agents: ['.agents'], skills: ['skills'], rules: ['rules'] })

    const res = await put(app, { rules: ['docs/rules'] })
    expect((await res.json()).config).toEqual({
      agents: ['.agents'],
      skills: ['skills'],
      rules: ['docs/rules'],
    })
  })

  test('unsafe patterns are dropped instead of stored', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    const res = await put(app, { agents: ['/etc', '../up', '~/x', './ok/'] })
    expect((await res.json()).config.agents).toEqual(['ok'])
  })

  test('a malformed body is rejected', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: null }))
    const res = await app.request('/api/scan-patterns', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not json',
    })
    expect(res.status).toBe(400)
  })
})

describe('scan patterns applied to catalog + rules', () => {
  let projectRoot: string
  let root: string
  const savedRoot = process.env.DEV_TEAM_ROOT

  beforeEach(() => {
    // DEV_TEAM_ROOT wins over ctx.defaultRoot in resolveProjectRoot — strip it
    // so the fixture project is what the endpoints actually read.
    delete process.env.DEV_TEAM_ROOT
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-patterns-project-'))
    root = path.join(projectRoot, '.dev-team-agent')
    fs.mkdirSync(root, { recursive: true })
    // Off-convention layout: nothing here matches the default scan paths.
    fs.mkdirSync(path.join(projectRoot, 'squad'), { recursive: true })
    fs.writeFileSync(
      path.join(projectRoot, 'squad', 'odd-agent.agent.md'),
      '---\ndescription: by pattern\n---\n',
    )
    fs.mkdirSync(path.join(projectRoot, 'guides'), { recursive: true })
    fs.writeFileSync(path.join(projectRoot, 'guides', 'house-style.md'), '# s')
  })

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true })
    if (savedRoot === undefined) delete process.env.DEV_TEAM_ROOT
    else process.env.DEV_TEAM_ROOT = savedRoot
  })

  test('GET /api/catalog and /api/rules pick up the configured patterns', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: root }))

    const before = await (await app.request('/api/catalog')).json()
    expect(before.agents.some((a: { name: string }) => a.name === 'odd-agent')).toBe(false)
    const rulesBefore = await (await app.request('/api/rules')).json()
    expect(rulesBefore.rules.some((r: { name: string }) => r.name === 'house-style')).toBe(false)

    await put(app, { agents: ['squad/*.md'], rules: ['guides'] })

    const after = await (await app.request('/api/catalog')).json()
    expect(after.agents.some((a: { name: string }) => a.name === 'odd-agent')).toBe(true)
    const rulesAfter = await (await app.request('/api/rules')).json()
    const style = rulesAfter.rules.find((r: { name: string }) => r.name === 'house-style')
    expect(style).toMatchObject({ path: 'guides/house-style.md', scope: 'project' })
  })

  test('clearing the patterns again restores the default listing', async () => {
    const app = await createApp(createRegistryContext({ defaultRoot: root }))
    await put(app, { agents: ['squad/*.md'], rules: ['guides'] })
    await put(app, { agents: [], skills: [], rules: [] })

    const cat = await (await app.request('/api/catalog')).json()
    expect(cat.agents.some((a: { name: string }) => a.name === 'odd-agent')).toBe(false)
    const rules = await (await app.request('/api/rules')).json()
    expect(rules.rules.some((r: { name: string }) => r.name === 'house-style')).toBe(false)
  })
})
