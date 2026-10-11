import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  buildCatalog,
  resolveCatalogAgentPath,
  resolveCatalogSkillPath,
  sourcePriority,
} from '../../../../src/features/pipeline-editor/business/catalog/index'
import { sanitiseAgentName } from '../../../../src/features/agent-editor/business/agents'

// Characterization cho #447 (Tfb77cf90-P8): khoá hành vi của từng nguồn catalog
// trước khi tách `catalog/scan.ts` thành `CatalogSource` mỗi nguồn một file.
// Mọi test ở đây chạy với HOME rỗng dựng riêng để không phụ thuộc máy chạy.

const savedHome = process.env.HOME
const savedUserProfile = process.env.USERPROFILE

let home: string
let projectRoot: string
let root: string

async function write(file: string, body: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, body)
}

async function installPlugin(name: string, installPath: string, enabled?: boolean) {
  const key = `${name}@market`
  const pluginsFile = path.join(home, '.claude', 'plugins', 'installed_plugins.json')
  let installed: Record<string, any> = {}
  try {
    installed = JSON.parse(await fs.readFile(pluginsFile, 'utf8')).plugins
  } catch {
    /* first install */
  }
  installed[key] = [{ installPath }]
  await write(pluginsFile, JSON.stringify({ plugins: installed }))
  if (enabled === false) {
    await write(path.join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { [key]: false } }))
  }
}

async function pluginDir(dir: string, skill: string, agent: string) {
  await write(path.join(dir, 'skills', skill, 'SKILL.md'), `---\nname: ${skill}\ndescription: ${skill} desc\n---\n`)
  await write(path.join(dir, 'agents', `${agent}.md`), `---\ndescription: ${agent} desc\n---\n`)
}

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-src-home-'))
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-src-proj-'))
  root = path.join(projectRoot, '.dev-team-agent')
  await fs.mkdir(root, { recursive: true })
  process.env.HOME = home
  process.env.USERPROFILE = home
})

afterEach(async () => {
  if (savedHome === undefined) delete process.env.HOME
  else process.env.HOME = savedHome
  if (savedUserProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = savedUserProfile
  await fs.rm(home, { recursive: true, force: true })
  await fs.rm(projectRoot, { recursive: true, force: true })
})

const noCustom = { scanCustomAgents: async () => [] }

describe('sourcePriority — non-string source', () => {
  test('a non-string source ranks 0', () => {
    expect(sourcePriority(undefined as unknown as string)).toBe(0)
    expect(sourcePriority(42 as unknown as string)).toBe(0)
  })
})

describe('buildCatalog — từng nguồn', () => {
  test('user: ~/.claude/skills + ~/.claude/agents', async () => {
    await write(path.join(home, '.claude', 'skills', 'u-skill', 'SKILL.md'), '---\nname: u-skill\n---\n')
    await write(path.join(home, '.claude', 'agents', 'u-agent.md'), '---\ndescription: ua\nskills: [u-skill]\n---\n')
    const cat = await buildCatalog(root, noCustom)
    expect(cat.skills).toEqual([
      { id: 'user:u-skill', name: 'u-skill', plugin: 'user', source: 'user', description: '', user_invocable: true },
    ])
    expect(cat.agents).toEqual([
      { id: 'user:u-agent', name: 'u-agent', plugin: 'user', source: 'user', description: 'ua', skills: ['u-skill'] },
    ])
  })

  test('cursor: ~/.cursor/skills-cursor', async () => {
    await write(path.join(home, '.cursor', 'skills-cursor', 'c-skill', 'SKILL.md'), '---\nname: c-skill\n---\n')
    const cat = await buildCatalog(root, noCustom)
    expect(cat.skills.map((s) => s.id)).toEqual(['cursor:c-skill'])
  })

  test('dashboard: lô scanCustomAgents được nhận root của `.dev-team-agent`', async () => {
    let seen: string | null = null
    const cat = await buildCatalog(root, {
      scanCustomAgents: async (r: string) => {
        seen = r
        return [{ id: 'dashboard:d', name: 'd', source: 'dashboard', description: '', skills: [] }]
      },
    })
    expect(seen).toBe(root)
    expect(cat.agents.map((a) => a.id)).toEqual(['dashboard:d'])
  })

  test('project: <project>/.claude/skills + agents', async () => {
    await write(path.join(projectRoot, '.claude', 'skills', 'p-skill', 'SKILL.md'), '---\nname: p-skill\n---\n')
    await write(path.join(projectRoot, '.claude', 'agents', 'p-agent.md'), '---\n---\n')
    const cat = await buildCatalog(root, noCustom)
    expect(cat.skills.map((s) => s.id)).toEqual(['project:p-skill'])
    expect(cat.agents.map((a) => a.id)).toEqual(['project:p-agent'])
  })

  test('installed plugin đang bật được quét với source plugin:<name>', async () => {
    const dir = path.join(home, 'installs', 'inst')
    await pluginDir(dir, 'i-skill', 'i-agent')
    await installPlugin('inst', dir)
    const cat = await buildCatalog(root, noCustom)
    expect(cat.skills.map((s) => s.id)).toEqual(['plugin:inst:i-skill'])
    expect(cat.agents.map((a) => a.id)).toEqual(['plugin:inst:i-agent'])
  })

  test('installed plugin bị tắt trong settings.json không được quét', async () => {
    const dir = path.join(home, 'installs', 'off')
    await pluginDir(dir, 'off-skill', 'off-agent')
    await installPlugin('off', dir, false)
    const cat = await buildCatalog(root, noCustom)
    expect(cat.skills.some((s) => s.name === 'off-skill')).toBe(false)
  })

  test('plugin cache chỉ được quét khi KHÔNG có install nào, chọn bản mới nhất theo mtime', async () => {
    const pluginPath = path.join(home, '.claude', 'plugins', 'cache', 'mkt', 'cached')
    await pluginDir(path.join(pluginPath, '1.0.0'), 'old-skill', 'old-agent')
    await pluginDir(path.join(pluginPath, '2.0.0'), 'new-skill', 'new-agent')
    const past = new Date(Date.now() - 60_000)
    await fs.utimes(path.join(pluginPath, '1.0.0'), past, past)

    const noInstall = await buildCatalog(root, noCustom)
    expect(noInstall.skills.map((s) => s.id)).toEqual(['plugin:cached:new-skill'])
    expect(noInstall.agents.map((a) => a.id)).toEqual(['plugin:cached:new-agent'])

    const dir = path.join(home, 'installs', 'inst')
    await pluginDir(dir, 'i-skill', 'i-agent')
    await installPlugin('inst', dir)
    const withInstall = await buildCatalog(root, noCustom)
    expect(withInstall.skills.map((s) => s.id)).toEqual(['plugin:inst:i-skill'])
  })

  test('repo plugin (marketplace.json) — không có install thì quét hết', async () => {
    await write(
      path.join(projectRoot, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({ plugins: [{ name: 'a', source: './plugins/a' }, { source: './plugins/b' }, { name: 'nosrc' }] }),
    )
    await pluginDir(path.join(projectRoot, 'plugins', 'a'), 'a-skill', 'a-agent')
    await pluginDir(path.join(projectRoot, 'plugins', 'b'), 'b-skill', 'b-agent')
    const cat = await buildCatalog(root, noCustom)
    expect(cat.skills.map((s) => s.id)).toEqual(['repo:a:a-skill', 'repo:b:b-skill'])
    expect(cat.agents.map((a) => a.id)).toEqual(['repo:a:a-agent', 'repo:b:b-agent'])
  })

  test('repo plugin — có install thì chỉ giữ plugin trùng tên với install đang bật', async () => {
    await write(
      path.join(projectRoot, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({ plugins: [{ name: 'a', source: './plugins/a' }, { name: 'b', source: './plugins/b' }] }),
    )
    await pluginDir(path.join(projectRoot, 'plugins', 'a'), 'a-skill', 'a-agent')
    await pluginDir(path.join(projectRoot, 'plugins', 'b'), 'b-skill', 'b-agent')
    const instDir = path.join(home, 'installs', 'a')
    await pluginDir(instDir, 'ia-skill', 'ia-agent')
    await installPlugin('a', instDir)
    const cat = await buildCatalog(root, noCustom)
    expect(cat.skills.map((s) => s.id)).toEqual(['repo:a:a-skill', 'plugin:a:ia-skill'])
  })

  test('trùng tên: dashboard > project > plugin > repo > user > cursor', async () => {
    const same = 'same'
    await write(path.join(home, '.cursor', 'skills-cursor', same, 'SKILL.md'), `---\nname: ${same}\n---\n`)
    await write(path.join(home, '.claude', 'skills', same, 'SKILL.md'), `---\nname: ${same}\n---\n`)
    await write(path.join(home, '.claude', 'agents', `${same}.md`), '---\n---\n')
    let cat = await buildCatalog(root, noCustom)
    expect(cat.skills.map((s) => s.id)).toEqual([`user:${same}`])

    await write(
      path.join(projectRoot, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({ plugins: [{ name: 'r', source: './plugins/r' }] }),
    )
    await pluginDir(path.join(projectRoot, 'plugins', 'r'), same, same)
    cat = await buildCatalog(root, noCustom)
    expect(cat.skills.map((s) => s.id)).toEqual([`repo:r:${same}`])
    expect(cat.agents.map((a) => a.id)).toEqual([`repo:r:${same}`])

    await pluginDir(path.join(home, '.claude', 'plugins', 'cache', 'mkt', 'c', '1.0.0'), same, same)
    cat = await buildCatalog(root, noCustom)
    expect(cat.skills.map((s) => s.id)).toEqual([`plugin:c:${same}`])

    await write(path.join(projectRoot, '.claude', 'agents', `${same}.md`), '---\n---\n')
    cat = await buildCatalog(root, noCustom)
    expect(cat.agents.map((a) => a.id)).toEqual([`project:${same}`])

    cat = await buildCatalog(root, {
      scanCustomAgents: async () => [{ id: `dashboard:${same}`, name: same, source: 'dashboard', description: '', skills: [] }],
    })
    expect(cat.agents.map((a) => a.id)).toEqual([`dashboard:${same}`])
  })

  test('không nguồn nào có gì → BUILTIN_CATALOG', async () => {
    const cat = await buildCatalog(root, noCustom)
    expect(cat.agents.every((a) => a.source === 'repo:dev-agent-teams')).toBe(true)
    expect(cat.agents.length).toBeGreaterThan(0)
  })
})

describe('resolveCatalogAgentPath — từng nguồn', () => {
  const customAgentsDir = (r: string) => path.join(r, 'custom-agents')

  test('user: ~/.claude/agents/<name>.md, không kiểm tồn tại', async () => {
    expect(await resolveCatalogAgentPath(projectRoot, root, 'user:ghost', { customAgentsDir })).toBe(
      path.join(home, '.claude', 'agents', 'ghost.md'),
    )
  })

  test('dashboard: không kiểm tồn tại', async () => {
    expect(await resolveCatalogAgentPath(projectRoot, root, 'dashboard:ghost', { customAgentsDir })).toBe(
      path.join(root, 'custom-agents', 'ghost.md'),
    )
  })

  test('cursor và nguồn lạ → null', async () => {
    expect(await resolveCatalogAgentPath(projectRoot, root, 'cursor:x', { customAgentsDir })).toBeNull()
    expect(await resolveCatalogAgentPath(projectRoot, root, 'weird:x', { customAgentsDir })).toBeNull()
  })

  test('repo: tra marketplace.json, không có marketplace → null (fallback plugins/ không nằm ở đây)', async () => {
    await pluginDir(path.join(projectRoot, 'plugins', 'r'), 's', 'a')
    expect(await resolveCatalogAgentPath(projectRoot, root, 'repo:r:a', { customAgentsDir })).toBeNull()
    await write(
      path.join(projectRoot, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({ plugins: [{ name: 'r', source: './somewhere/r' }] }),
    )
    expect(await resolveCatalogAgentPath(projectRoot, root, 'repo:r:a', { customAgentsDir })).toBe(
      path.join(projectRoot, 'somewhere', 'r', 'agents', 'a.md'),
    )
    expect(await resolveCatalogAgentPath(projectRoot, root, 'repo:other:a', { customAgentsDir })).toBeNull()
  })

  test('plugin: install trước, rồi plugin cache, rồi null', async () => {
    expect(await resolveCatalogAgentPath(projectRoot, root, 'plugin:p:a', { customAgentsDir })).toBeNull()
    const cacheDir = path.join(home, '.claude', 'plugins', 'cache', 'mkt', 'p', '1.0.0')
    await fs.mkdir(cacheDir, { recursive: true })
    expect(await resolveCatalogAgentPath(projectRoot, root, 'plugin:p:a', { customAgentsDir })).toBe(
      path.join(cacheDir, 'agents', 'a.md'),
    )
    const instDir = path.join(home, 'installs', 'p')
    await installPlugin('p', instDir)
    expect(await resolveCatalogAgentPath(projectRoot, root, 'plugin:p:a', { customAgentsDir })).toBe(
      path.join(instDir, 'agents', 'a.md'),
    )
  })
})

describe('resolveCatalogSkillPath — nguồn còn thiếu', () => {
  const deps = { sanitiseName: sanitiseAgentName }

  test('plugin: install đang bật thắng plugin cache', async () => {
    const cacheDir = path.join(home, '.claude', 'plugins', 'cache', 'mkt', 'p', '1.0.0')
    await fs.mkdir(cacheDir, { recursive: true })
    const instDir = path.join(home, 'installs', 'p')
    await installPlugin('p', instDir)
    expect(await resolveCatalogSkillPath(projectRoot, 'plugin:p:s', deps)).toBe(
      path.join(instDir, 'skills', 's', 'SKILL.md'),
    )
  })

  test('dashboard và nguồn lạ → null', async () => {
    expect(await resolveCatalogSkillPath(projectRoot, 'dashboard:s', deps)).toBeNull()
    expect(await resolveCatalogSkillPath(projectRoot, 'weird:s', deps)).toBeNull()
  })

  test('tên bị sanitise gọt → null trước khi chạm nguồn nào', async () => {
    expect(await resolveCatalogSkillPath(projectRoot, 'user:a.b', deps)).toBeNull()
  })
})
