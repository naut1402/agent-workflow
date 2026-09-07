import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildCatalog, parseCatalogAgentId, resolveCatalogAgentPath } from '../../../../src/features/pipeline-editor/business/catalog/index'

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

describe('buildCatalog with custom scan patterns', () => {
  let projectRoot: string
  let root: string
  let emptyHome: string
  const savedHome = process.env.HOME
  const savedUserProfile = process.env.USERPROFILE

  beforeAll(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-patterns-'))
    root = path.join(projectRoot, '.dev-team-agent')
    await fs.mkdir(root, { recursive: true })
    emptyHome = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-empty-home-'))

    // Convention source: .claude/agents holds `dup`.
    await fs.mkdir(path.join(projectRoot, '.claude', 'agents'), { recursive: true })
    await fs.writeFile(
      path.join(projectRoot, '.claude', 'agents', 'dup.md'),
      '---\ndescription: from the default source\n---\n',
    )
    // Off-convention sources reachable only through patterns.
    await fs.mkdir(path.join(projectRoot, '.agents'), { recursive: true })
    await fs.writeFile(
      path.join(projectRoot, '.agents', 'odd-agent.agent.md'),
      '---\ndescription: found by pattern\n---\n',
    )
    await fs.writeFile(
      path.join(projectRoot, '.agents', 'dup.md'),
      '---\ndescription: from the pattern source\n---\n',
    )
    await fs.mkdir(path.join(projectRoot, 'flat-skills'), { recursive: true })
    await fs.writeFile(
      path.join(projectRoot, 'flat-skills', 'odd-skill.md'),
      '---\ndescription: skill by pattern\n---\n',
    )
  })

  afterAll(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true })
    await fs.rm(emptyHome, { recursive: true, force: true })
  })

  const withEmptyHome = async <T>(fn: () => Promise<T>): Promise<T> => {
    process.env.HOME = emptyHome
    process.env.USERPROFILE = emptyHome
    try {
      return await fn()
    } finally {
      if (savedHome === undefined) delete process.env.HOME
      else process.env.HOME = savedHome
      if (savedUserProfile === undefined) delete process.env.USERPROFILE
      else process.env.USERPROFILE = savedUserProfile
    }
  }

  test('omitting scanPatterns matches passing three empty lists', async () => {
    const without = await buildCatalog(root, { scanCustomAgents: async () => [] })
    const withEmpty = await buildCatalog(root, {
      scanCustomAgents: async () => [],
      scanPatterns: { agents: [], skills: [], rules: [] },
    })
    expect(withEmpty).toEqual(without)
  })

  test('agents and skills from patterns are added to the catalog', async () => {
    const cat = await buildCatalog(root, {
      scanCustomAgents: async () => [],
      scanPatterns: { agents: ['.agents/*.md'], skills: ['flat-skills/*.md'], rules: [] },
    })
    expect(cat.agents.some((a) => a.name === 'odd-agent')).toBe(true)
    expect(cat.skills.some((s) => s.name === 'odd-skill')).toBe(true)
  })

  test('on a name clash the default source wins over the pattern source', async () => {
    const cat = await buildCatalog(root, {
      scanCustomAgents: async () => [],
      scanPatterns: { agents: ['.agents/*.md'], skills: [], rules: [] },
    })
    const dup = cat.agents.filter((a) => a.name === 'dup')
    expect(dup).toHaveLength(1)
    expect(dup[0].description).toBe('from the default source')
  })

  test('a pattern hit stops the builtin fallback from kicking in', async () => {
    const bare = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-bare-'))
    const bareRoot = path.join(bare, '.dev-team-agent')
    await fs.mkdir(path.join(bare, 'odd'), { recursive: true })
    await fs.writeFile(path.join(bare, 'odd', 'only-agent.md'), '---\ndescription: only one\n---\n')
    try {
      const builtin = await withEmptyHome(() =>
        buildCatalog(bareRoot, { scanCustomAgents: async () => [] }),
      )
      expect(builtin.agents.length).toBeGreaterThan(1)

      const patterned = await withEmptyHome(() =>
        buildCatalog(bareRoot, {
          scanCustomAgents: async () => [],
          scanPatterns: { agents: ['odd/*.md'], skills: [], rules: [] },
        }),
      )
      expect(patterned.agents.map((a) => a.name)).toEqual(['only-agent'])
      expect(patterned.skills).toEqual([])
    } finally {
      await fs.rm(bare, { recursive: true, force: true })
    }
  })
})
