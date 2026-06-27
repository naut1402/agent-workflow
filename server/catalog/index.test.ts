import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildCatalog, parseCatalogAgentId, resolveCatalogAgentPath } from './index'

describe('parseCatalogAgentId', () => {
  test('splits on the last colon into source + name', () => {
    expect(parseCatalogAgentId('repo:dev-agent-teams:investigator')).toEqual({
      source: 'repo:dev-agent-teams',
      name: 'investigator',
    })
    expect(parseCatalogAgentId('user:foo')).toEqual({ source: 'user', name: 'foo' })
  })
  test('returns null for invalid ids', () => {
    expect(parseCatalogAgentId('noColon')).toBeNull()
    expect(parseCatalogAgentId(':leading')).toBeNull()
    expect(parseCatalogAgentId(123 as unknown as string)).toBeNull()
  })
})

describe('resolveCatalogAgentPath', () => {
  const customAgentsDir = (root: string) => path.join(root, 'custom-agents')
  const root = path.resolve('/data/.dev-team-agent')
  const projectRoot = path.dirname(root)

  test('dashboard source uses injected customAgentsDir', async () => {
    const p = await resolveCatalogAgentPath(projectRoot, root, 'dashboard:my-agent', { customAgentsDir })
    expect(p).toBe(path.join(root, 'custom-agents', 'my-agent.md'))
  })
  test('project source resolves under projectRoot/.claude/agents', async () => {
    const p = await resolveCatalogAgentPath(projectRoot, root, 'project:foo', { customAgentsDir })
    expect(p).toBe(path.join(projectRoot, '.claude', 'agents', 'foo.md'))
  })
  test('returns null for an invalid id', async () => {
    expect(await resolveCatalogAgentPath(projectRoot, root, 'bogus', { customAgentsDir })).toBeNull()
  })
})

describe('buildCatalog fallback', () => {
  let root: string
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-build-'))
  })
  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  test('returns a catalog with skills + agents arrays', async () => {
    const cat = await buildCatalog(root, { scanCustomAgents: async () => [] })
    expect(Array.isArray(cat.skills)).toBe(true)
    expect(Array.isArray(cat.agents)).toBe(true)
    // Either real on-disk discovery or the builtin fallback — never empty both.
    expect(cat.skills.length + cat.agents.length).toBeGreaterThan(0)
  })

  test('injected scanCustomAgents items are merged in', async () => {
    const custom = [{ id: 'dashboard:zzz-unique', name: 'zzz-unique', source: 'dashboard', description: 'x', skills: [] }]
    const cat = await buildCatalog(root, { scanCustomAgents: async () => custom })
    expect(cat.agents.some((a) => a.name === 'zzz-unique')).toBe(true)
  })
})
