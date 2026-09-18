import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  buildCatalog,
  parseCatalogItemId,
  resolveCatalogAgentPath,
  resolveCatalogSkillPath,
} from '../../../../src/features/pipeline-editor/business/catalog/index'
import { sanitiseAgentName } from '../../../../src/features/agent-editor/business/agents'

describe('parseCatalogItemId', () => {
  test('splits on the last colon into source + name', () => {
    expect(parseCatalogItemId('repo:dev-agent-teams:investigator')).toEqual({
      source: 'repo:dev-agent-teams',
      name: 'investigator',
    })
    expect(parseCatalogItemId('user:foo')).toEqual({ source: 'user', name: 'foo' })
  })
  test('returns null for invalid ids', () => {
    expect(parseCatalogItemId('noColon')).toBeNull()
    expect(parseCatalogItemId(':leading')).toBeNull()
    expect(parseCatalogItemId(123 as unknown as string)).toBeNull()
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
  test('returns null for an invalid id', async () => {
    expect(await resolveCatalogAgentPath(projectRoot, root, 'bogus', { customAgentsDir })).toBeNull()
  })

  // `project` source has two possible origins with the same id shape
  // (`project:<name>`): the fixed `.claude/agents/<name>.md` convention, and a
  // `scanPatterns.agents` wildcard match — T8ee57185 §7 (investigate.md):
  // before this, an agent findable only via wildcard scan could never be
  // opened, because this function always assumed the convention path.
  describe('project source', () => {
    let tmpProjectRoot: string
    let tmpRoot: string

    beforeAll(async () => {
      tmpProjectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-agent-project-'))
      tmpRoot = path.join(tmpProjectRoot, '.dev-team-agent')
      await fs.mkdir(path.join(tmpProjectRoot, '.claude', 'agents'), { recursive: true })
      await fs.writeFile(path.join(tmpProjectRoot, '.claude', 'agents', 'conventional.md'), '# body')
      await fs.mkdir(path.join(tmpProjectRoot, 'docs', 'template', 'agents'), { recursive: true })
      await fs.writeFile(path.join(tmpProjectRoot, 'docs', 'template', 'agents', 'wildcard-only.md'), '# body')
    })

    afterAll(async () => {
      await fs.rm(tmpProjectRoot, { recursive: true, force: true })
    })

    test('resolves the conventional path when the file exists on disk', async () => {
      const p = await resolveCatalogAgentPath(tmpProjectRoot, tmpRoot, 'project:conventional', { customAgentsDir })
      expect(p).toBe(path.join(tmpProjectRoot, '.claude', 'agents', 'conventional.md'))
    })

    test('falls back to scanPatterns.agents when the conventional path does not exist', async () => {
      const p = await resolveCatalogAgentPath(tmpProjectRoot, tmpRoot, 'project:wildcard-only', {
        customAgentsDir,
        scanPatterns: ['docs/template/agents'],
      })
      expect(p).toBe(path.join(tmpProjectRoot, 'docs', 'template', 'agents', 'wildcard-only.md'))
    })

    test('the conventional path wins over a same-named scanPatterns match', async () => {
      const patternDir = path.join(tmpProjectRoot, 'docs', 'template', 'agents2')
      await fs.mkdir(patternDir, { recursive: true })
      await fs.writeFile(path.join(patternDir, 'conventional.md'), '# must not win')

      const p = await resolveCatalogAgentPath(tmpProjectRoot, tmpRoot, 'project:conventional', {
        customAgentsDir,
        scanPatterns: ['docs/template/agents2'],
      })
      expect(p).toBe(path.join(tmpProjectRoot, '.claude', 'agents', 'conventional.md'))
    })

    test('returns null when the conventional path is missing and no scanPatterns are configured', async () => {
      const p = await resolveCatalogAgentPath(tmpProjectRoot, tmpRoot, 'project:wildcard-only', { customAgentsDir })
      expect(p).toBeNull()
    })

    test('returns null when neither the conventional path nor any pattern matches', async () => {
      const p = await resolveCatalogAgentPath(tmpProjectRoot, tmpRoot, 'project:missing', {
        customAgentsDir,
        scanPatterns: ['docs/template/agents'],
      })
      expect(p).toBeNull()
    })
  })
})

// Mirror của `resolveCatalogAgentPath`, nhưng tự sanitize `name` (route mới —
// AGENTS.md §4, xem design.md §4.2/§4.4 của T21270146).
describe('resolveCatalogSkillPath', () => {
  const deps = { sanitiseName: sanitiseAgentName }
  const root = path.resolve('/data/.dev-team-agent')
  const projectRoot = path.dirname(root)

  test('user source resolves under ~/.claude/skills', async () => {
    const p = await resolveCatalogSkillPath(projectRoot, 'user:foo', deps)
    expect(p).toBe(path.join(os.homedir(), '.claude', 'skills', 'foo', 'SKILL.md'))
  })

  test('cursor source resolves under ~/.cursor/skills-cursor', async () => {
    const p = await resolveCatalogSkillPath(projectRoot, 'cursor:foo', deps)
    expect(p).toBe(path.join(os.homedir(), '.cursor', 'skills-cursor', 'foo', 'SKILL.md'))
  })

  // Mirror của nhóm test `resolveCatalogAgentPath` — `project` source cho skill
  // cũng có 2 nguồn cùng id shape (`project:<name>`): convention và
  // `scanPatterns.skills` wildcard (T8ee57185 §7).
  describe('project source', () => {
    let tmpProjectRoot: string

    beforeAll(async () => {
      tmpProjectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-skill-project-'))
      await fs.mkdir(path.join(tmpProjectRoot, '.claude', 'skills', 'conventional'), { recursive: true })
      await fs.writeFile(
        path.join(tmpProjectRoot, '.claude', 'skills', 'conventional', 'SKILL.md'),
        '---\nname: conventional\n---\n',
      )
      await fs.mkdir(path.join(tmpProjectRoot, 'docs', 'template', 'skills', 'wildcard-only'), { recursive: true })
      await fs.writeFile(
        path.join(tmpProjectRoot, 'docs', 'template', 'skills', 'wildcard-only', 'SKILL.md'),
        '---\nname: wildcard-only\n---\n',
      )
    })

    afterAll(async () => {
      await fs.rm(tmpProjectRoot, { recursive: true, force: true })
    })

    test('resolves the conventional path when the file exists on disk', async () => {
      const p = await resolveCatalogSkillPath(tmpProjectRoot, 'project:conventional', deps)
      expect(p).toBe(path.join(tmpProjectRoot, '.claude', 'skills', 'conventional', 'SKILL.md'))
    })

    test('falls back to scanPatterns.skills when the conventional path does not exist', async () => {
      const p = await resolveCatalogSkillPath(tmpProjectRoot, 'project:wildcard-only', {
        ...deps,
        scanPatterns: ['docs/template/skills'],
      })
      expect(p).toBe(path.join(tmpProjectRoot, 'docs', 'template', 'skills', 'wildcard-only', 'SKILL.md'))
    })

    test('returns null when the conventional path is missing and no scanPatterns are configured', async () => {
      const p = await resolveCatalogSkillPath(tmpProjectRoot, 'project:wildcard-only', deps)
      expect(p).toBeNull()
    })
  })

  test('returns null for an invalid id (no colon)', async () => {
    expect(await resolveCatalogSkillPath(projectRoot, 'bogus', deps)).toBeNull()
  })

  // TC-C2/TC-C3 ở mức pure-function — id giả mạo path-traversal trong phần TÊN.
  test('rejects a name containing ".." or a path separator', async () => {
    expect(await resolveCatalogSkillPath(projectRoot, 'user:../../../etc/passwd', deps)).toBeNull()
    expect(await resolveCatalogSkillPath(projectRoot, 'user:/etc/passwd', deps)).toBeNull()
  })

  describe('repo: source — resolved via marketplace.json', () => {
    let tmpProjectRoot: string

    beforeEach(async () => {
      tmpProjectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-repo-'))
      await fs.mkdir(path.join(tmpProjectRoot, '.claude-plugin'), { recursive: true })
      await fs.writeFile(
        path.join(tmpProjectRoot, '.claude-plugin', 'marketplace.json'),
        JSON.stringify({ plugins: [{ name: 'dev-agent-teams', source: 'plugins/dev-agent-teams' }] }),
      )
    })

    afterEach(async () => {
      await fs.rm(tmpProjectRoot, { recursive: true, force: true })
    })

    test('resolves to <marketplace plugin source>/skills/<name>/SKILL.md', async () => {
      const p = await resolveCatalogSkillPath(tmpProjectRoot, 'repo:dev-agent-teams:survey-codebase', deps)
      expect(p).toBe(
        path.join(tmpProjectRoot, 'plugins', 'dev-agent-teams', 'skills', 'survey-codebase', 'SKILL.md'),
      )
    })

    test('returns null when the plugin name does not match any marketplace entry', async () => {
      expect(await resolveCatalogSkillPath(tmpProjectRoot, 'repo:no-such-plugin:x', deps)).toBeNull()
    })

    test('returns null when there is no marketplace.json at all (no traversal fallback here)', async () => {
      const bare = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-repo-bare-'))
      try {
        expect(await resolveCatalogSkillPath(bare, 'repo:dev-agent-teams:x', deps)).toBeNull()
      } finally {
        await fs.rm(bare, { recursive: true, force: true })
      }
    })
  })

  describe('plugin: source — resolved via plugin cache', () => {
    let home: string
    const savedHome = process.env.HOME
    const savedUserProfile = process.env.USERPROFILE

    beforeEach(async () => {
      home = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-plugin-home-'))
      process.env.HOME = home
      process.env.USERPROFILE = home
    })

    afterEach(async () => {
      if (savedHome === undefined) delete process.env.HOME
      else process.env.HOME = savedHome
      if (savedUserProfile === undefined) delete process.env.USERPROFILE
      else process.env.USERPROFILE = savedUserProfile
      await fs.rm(home, { recursive: true, force: true })
    })

    test('falls back to the latest plugin cache dir when nothing is installed', async () => {
      const cacheDir = path.join(home, '.claude', 'plugins', 'cache', 'some-marketplace', 'my-plugin', '1.0.0')
      await fs.mkdir(cacheDir, { recursive: true })

      const p = await resolveCatalogSkillPath(projectRoot, 'plugin:my-plugin:my-skill', deps)
      expect(p).toBe(path.join(cacheDir, 'skills', 'my-skill', 'SKILL.md'))
    })

    test('returns null when the plugin is neither installed nor cached', async () => {
      expect(await resolveCatalogSkillPath(projectRoot, 'plugin:missing:x', deps)).toBeNull()
    })
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
