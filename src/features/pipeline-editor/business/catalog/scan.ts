import fs from 'node:fs/promises'
import path from 'node:path'
import { homeDir, safeReadDir, statSafe } from '../../../../core/lib/fileHelper.js'
import { parseFrontmatter } from '../../../../core/lib/yamlLib.js'

export interface ScanOpts {
  includeContractSkills?: boolean
  enabledPluginNames?: Set<string> | null
}

export interface ScanResult {
  skills: any[]
  agents: any[]
}

// Walk up from `startDir` looking for `.claude-plugin/marketplace.json`.
export async function findMarketplaceJson(startDir: string) {
  let dir = startDir
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, '.claude-plugin', 'marketplace.json')
    try {
      const raw = await fs.readFile(candidate, 'utf8')
      return { file: candidate, dir, data: JSON.parse(raw) }
    } catch {
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return null
}

// Scan a plugin source directory for SKILL.md files and agent .md files.
export async function scanPlugin(
  pluginDir: string,
  source: string | null,
  pluginLabel?: string,
  opts: ScanOpts = {},
): Promise<ScanResult> {
  const { includeContractSkills = true } = opts
  const pluginName = pluginLabel || path.basename(pluginDir)
  const src = source || `repo:${pluginName}`
  const skills: any[] = []
  const agents: any[] = []

  const skillsDir = path.join(pluginDir, 'skills')
  try {
    for (const entry of await fs.readdir(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const skillMd = path.join(skillsDir, entry.name, 'SKILL.md')
      try {
        const raw = await fs.readFile(skillMd, 'utf8')
        const fm = parseFrontmatter(raw)
        if (!fm.name) continue
        const userInvocable = fm['user-invocable'] !== false
        if (!includeContractSkills && !userInvocable) continue
        skills.push({
          id: `${src}:${fm.name}`,
          name: fm.name,
          plugin: pluginName,
          source: src,
          description: (fm.description || '').slice(0, 140),
          user_invocable: userInvocable,
        })
      } catch {
        /* skip */
      }
    }
  } catch {
    /* no skills dir */
  }

  const agentsDir = path.join(pluginDir, 'agents')
  try {
    for (const entry of await fs.readdir(agentsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const agentName = entry.name.replace(/\.md$/, '')
      try {
        const raw = await fs.readFile(path.join(agentsDir, entry.name), 'utf8')
        const fm = parseFrontmatter(raw)
        agents.push({
          id: `${src}:${agentName}`,
          name: agentName,
          plugin: pluginName,
          source: src,
          description: (fm.description || '').slice(0, 140),
          skills: Array.isArray(fm.skills) ? fm.skills : [],
        })
      } catch {
        /* skip */
      }
    }
  } catch {
    /* no agents dir */
  }

  return { skills, agents }
}

export async function scanSkillsFlatDir(
  skillsRoot: string,
  source: string,
  pluginLabel: string,
  opts: ScanOpts = {},
): Promise<any[]> {
  const { includeContractSkills = true } = opts
  const skills: any[] = []
  for (const entry of await safeReadDir(skillsRoot)) {
    if (!entry.isDirectory()) continue
    const skillMd = path.join(skillsRoot, entry.name, 'SKILL.md')
    try {
      const raw = await fs.readFile(skillMd, 'utf8')
      const fm = parseFrontmatter(raw)
      if (!fm.name) continue
      const userInvocable = fm['user-invocable'] !== false
      if (!includeContractSkills && !userInvocable) continue
      skills.push({
        id: `${source}:${fm.name}`,
        name: fm.name,
        plugin: pluginLabel,
        source,
        description: (fm.description || '').slice(0, 140),
        user_invocable: userInvocable,
      })
    } catch {
      /* skip */
    }
  }
  return skills
}

export async function scanAgentsInDir(
  agentsRoot: string,
  source: string,
  pluginLabel: string,
): Promise<any[]> {
  const agents: any[] = []
  for (const entry of await safeReadDir(agentsRoot)) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const agentName = entry.name.replace(/\.md$/, '')
    try {
      const raw = await fs.readFile(path.join(agentsRoot, entry.name), 'utf8')
      const fm = parseFrontmatter(raw)
      agents.push({
        id: `${source}:${agentName}`,
        name: agentName,
        plugin: pluginLabel,
        source,
        description: (fm.description || '').slice(0, 140),
        skills: Array.isArray(fm.skills) ? fm.skills : [],
      })
    } catch {
      /* skip */
    }
  }
  return agents
}

export async function scanRepoPlugins(projectRoot: string, opts: ScanOpts = {}): Promise<ScanResult> {
  const found = await findMarketplaceJson(projectRoot)
  if (!found) return { skills: [], agents: [] }
  const enabledNames = opts.enabledPluginNames
  const allSkills: any[] = []
  const allAgents: any[] = []
  const plugins = Array.isArray(found.data.plugins) ? found.data.plugins : []
  for (const p of plugins) {
    if (!p.source) continue
    const pluginName = p.name || path.basename(p.source)
    if (enabledNames && !enabledNames.has(pluginName)) continue
    const pluginDir = path.resolve(found.dir, p.source)
    try {
      const { skills, agents } = await scanPlugin(pluginDir, `repo:${pluginName}`, pluginName, opts)
      allSkills.push(...skills)
      allAgents.push(...agents)
    } catch {
      /* skip */
    }
  }
  return { skills: allSkills, agents: allAgents }
}

export async function scanPluginCache(opts: ScanOpts = {}): Promise<ScanResult> {
  const cacheRoot = path.join(homeDir(), '.claude', 'plugins', 'cache')
  const allSkills: any[] = []
  const allAgents: any[] = []
  for (const market of await safeReadDir(cacheRoot)) {
    if (!market.isDirectory()) continue
    const marketPath = path.join(cacheRoot, market.name)
    for (const plugin of await safeReadDir(marketPath)) {
      if (!plugin.isDirectory()) continue
      const pluginPath = path.join(marketPath, plugin.name)
      const versions = (await safeReadDir(pluginPath)).filter((e) => e.isDirectory())
      if (!versions.length) continue
      let latestDir = versions[0].name
      let latestMtime = 0
      for (const v of versions) {
        const meta = await statSafe(path.join(pluginPath, v.name))
        if (meta.mtime! > latestMtime) {
          latestMtime = meta.mtime!
          latestDir = v.name
        }
      }
      const versionDir = path.join(pluginPath, latestDir)
      const { skills, agents } = await scanPlugin(versionDir, `plugin:${plugin.name}`, plugin.name, opts)
      allSkills.push(...skills)
      allAgents.push(...agents)
    }
  }
  return { skills: allSkills, agents: allAgents }
}

export interface PluginInstall {
  installPath: string
  pluginKey: string
  name: string
}

// Installed + enabled Claude Code plugins (`installed_plugins.json` + `settings.json`).
export async function loadEnabledPluginInstalls(): Promise<PluginInstall[]> {
  const claudeDir = path.join(homeDir(), '.claude')
  let installed: Record<string, any> = {}
  let enabled: Record<string, any> = {}
  try {
    const raw = await fs.readFile(path.join(claudeDir, 'plugins', 'installed_plugins.json'), 'utf8')
    installed = JSON.parse(raw).plugins || {}
  } catch {
    return []
  }
  try {
    const raw = await fs.readFile(path.join(claudeDir, 'settings.json'), 'utf8')
    enabled = JSON.parse(raw).enabledPlugins || {}
  } catch {
    /* all installed treated as enabled when settings missing */
  }

  const installs: PluginInstall[] = []
  for (const [pluginKey, entries] of Object.entries(installed)) {
    if (enabled[pluginKey] === false) continue
    const list = Array.isArray(entries) ? entries : [entries]
    for (const entry of list) {
      if (!entry?.installPath) continue
      const shortName = pluginKey.split('@')[0]
      installs.push({ installPath: entry.installPath, pluginKey, name: shortName })
    }
  }
  return installs
}

export async function scanEnabledInstalledPlugins(): Promise<ScanResult> {
  const installs = await loadEnabledPluginInstalls()
  if (!installs.length) return { skills: [], agents: [] }

  const allSkills: any[] = []
  const allAgents: any[] = []
  const catalogOpts: ScanOpts = { includeContractSkills: true }
  for (const { installPath, name } of installs) {
    try {
      const { skills, agents } = await scanPlugin(installPath, `plugin:${name}`, name, catalogOpts)
      allSkills.push(...skills)
      allAgents.push(...agents)
    } catch {
      /* skip broken install */
    }
  }
  return { skills: allSkills, agents: allAgents }
}

export async function scanUserSkills(opts: ScanOpts = {}): Promise<ScanResult> {
  const dir = path.join(homeDir(), '.claude', 'skills')
  return { skills: await scanSkillsFlatDir(dir, 'user', 'user', opts), agents: [] }
}

export async function scanUserAgents(): Promise<ScanResult> {
  const dir = path.join(homeDir(), '.claude', 'agents')
  return { skills: [], agents: await scanAgentsInDir(dir, 'user', 'user') }
}

export async function scanCursorSkills(opts: ScanOpts = {}): Promise<ScanResult> {
  const dir = path.join(homeDir(), '.cursor', 'skills-cursor')
  return { skills: await scanSkillsFlatDir(dir, 'cursor', 'cursor', opts), agents: [] }
}

export async function scanProjectClaude(projectRoot: string, opts: ScanOpts = {}): Promise<ScanResult> {
  const skills = await scanSkillsFlatDir(path.join(projectRoot, '.claude', 'skills'), 'project', 'project', opts)
  const agents = await scanAgentsInDir(path.join(projectRoot, '.claude', 'agents'), 'project', 'project')
  return { skills, agents }
}

export async function latestPluginCacheDir(pluginName: string): Promise<string | null> {
  const cacheRoot = path.join(homeDir(), '.claude', 'plugins', 'cache')
  for (const market of await safeReadDir(cacheRoot)) {
    if (!market.isDirectory()) continue
    const pluginPath = path.join(cacheRoot, market.name, pluginName)
    const versions = (await safeReadDir(pluginPath)).filter((e) => e.isDirectory())
    if (!versions.length) continue
    let latestDir = versions[0].name
    let latestMtime = 0
    for (const v of versions) {
      const meta = await statSafe(path.join(pluginPath, v.name))
      if (meta.mtime! > latestMtime) {
        latestMtime = meta.mtime!
        latestDir = v.name
      }
    }
    return path.join(pluginPath, latestDir)
  }
  return null
}
