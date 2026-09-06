import { basename, dirname, homeDir, joinPath, readDir, readFile, readTextFile, resolvePath, safeReadDir, statSafe } from '../../../../core/lib/fileHelper.js'
import { parseFrontmatter } from '../../../../core/lib/yamlLib.js'
import { expandScanPatterns } from '../scanPatterns.js'

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
    const candidate = joinPath(dir, '.claude-plugin', 'marketplace.json')
    try {
      const raw = await readTextFile(candidate)
      return { file: candidate, dir, data: JSON.parse(raw) }
    } catch {
      const parent = dirname(dir)
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
  const pluginName = pluginLabel || basename(pluginDir)
  const src = source || `repo:${pluginName}`
  const skills: any[] = []
  const agents: any[] = []

  const skillsDir = joinPath(pluginDir, 'skills')
  try {
    for (const entry of await readDir(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const skillMd = joinPath(skillsDir, entry.name, 'SKILL.md')
      try {
        const raw = await readTextFile(skillMd)
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

  const agentsDir = joinPath(pluginDir, 'agents')
  try {
    for (const entry of await readDir(agentsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const agentName = entry.name.replace(/\.md$/, '')
      try {
        const raw = await readFile(joinPath(agentsDir, entry.name), 'utf8')
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
    const skillMd = joinPath(skillsRoot, entry.name, 'SKILL.md')
    try {
      const raw = await readTextFile(skillMd)
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

/** Markdown extensions accepted for a file matched by a custom scan pattern. */
const PATTERN_MD_EXT = /\.(md|mdc|markdown)$/i
const SKILL_ENTRY_FILE = /^skill\.(md|mdc|markdown)$/i

/** Item name derived from a file name: drop the extension, then a `.agent` / `.skill` suffix. */
function deriveItemName(file: string): string {
  return basename(file)
    .replace(PATTERN_MD_EXT, '')
    .replace(/\.(agent|agents|skill|skills)$/i, '')
    .trim()
}

/**
 * Read one agent markdown file. `opts.name` pins the name (convention scan keeps
 * using the file name so its output never shifts); `preferFrontmatterName` is only
 * for the custom-pattern branch, where the file name may be arbitrary.
 */
async function readAgentFile(
  file: string,
  source: string,
  pluginLabel: string,
  opts: { name?: string; preferFrontmatterName?: boolean } = {},
): Promise<any | null> {
  try {
    const raw = await readFile(file, 'utf8')
    const fm = parseFrontmatter(raw)
    const fmName = typeof fm.name === 'string' ? fm.name.trim() : ''
    const name = opts.preferFrontmatterName && fmName ? fmName : opts.name ?? deriveItemName(file)
    if (!name) return null
    return {
      id: `${source}:${name}`,
      name,
      plugin: pluginLabel,
      source,
      description: (fm.description || '').slice(0, 140),
      skills: Array.isArray(fm.skills) ? fm.skills : [],
    }
  } catch {
    return null
  }
}

export async function scanAgentsInDir(
  agentsRoot: string,
  source: string,
  pluginLabel: string,
): Promise<any[]> {
  const agents: any[] = []
  for (const entry of await safeReadDir(agentsRoot)) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const item = await readAgentFile(joinPath(agentsRoot, entry.name), source, pluginLabel, {
      name: entry.name.replace(/\.md$/, ''),
    })
    if (item) agents.push(item)
  }
  return agents
}

/**
 * Agents from custom scan patterns. A matched directory goes through the normal
 * directory scanner; a matched file is loaded on its own.
 */
export async function scanAgentsByPatterns(
  projectRoot: string,
  patterns: string[] | null | undefined,
): Promise<any[]> {
  const agents: any[] = []
  for (const match of await expandScanPatterns(projectRoot, patterns)) {
    if (match.isDirectory) {
      agents.push(...(await scanAgentsInDir(match.path, 'project', 'project')))
      continue
    }
    if (!PATTERN_MD_EXT.test(match.path)) continue
    const item = await readAgentFile(match.path, 'project', 'project', { preferFrontmatterName: true })
    if (item) agents.push(item)
  }
  return agents
}

/** Skills from custom scan patterns — same dir/file split as scanAgentsByPatterns. */
export async function scanSkillsByPatterns(
  projectRoot: string,
  patterns: string[] | null | undefined,
  opts: ScanOpts = {},
): Promise<any[]> {
  const { includeContractSkills = true } = opts
  const skills: any[] = []
  for (const match of await expandScanPatterns(projectRoot, patterns)) {
    if (match.isDirectory) {
      skills.push(...(await scanSkillsFlatDir(match.path, 'project', 'project', opts)))
      continue
    }
    if (!PATTERN_MD_EXT.test(match.path)) continue
    try {
      const fm = parseFrontmatter(await readTextFile(match.path))
      const fmName = typeof fm.name === 'string' ? fm.name.trim() : ''
      // No frontmatter name: a SKILL.md is named after its folder, anything else after the file.
      const name = fmName
        || (SKILL_ENTRY_FILE.test(basename(match.path))
          ? basename(dirname(match.path))
          : deriveItemName(match.path))
      if (!name) continue
      const userInvocable = fm['user-invocable'] !== false
      if (!includeContractSkills && !userInvocable) continue
      skills.push({
        id: `project:${name}`,
        name,
        plugin: 'project',
        source: 'project',
        description: (fm.description || '').slice(0, 140),
        user_invocable: userInvocable,
      })
    } catch {
      /* skip */
    }
  }
  return skills
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
    const pluginName = p.name || basename(p.source)
    if (enabledNames && !enabledNames.has(pluginName)) continue
    const pluginDir = resolvePath(found.dir, p.source)
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
  const cacheRoot = joinPath(homeDir(), '.claude', 'plugins', 'cache')
  const allSkills: any[] = []
  const allAgents: any[] = []
  for (const market of await safeReadDir(cacheRoot)) {
    if (!market.isDirectory()) continue
    const marketPath = joinPath(cacheRoot, market.name)
    for (const plugin of await safeReadDir(marketPath)) {
      if (!plugin.isDirectory()) continue
      const pluginPath = joinPath(marketPath, plugin.name)
      const versions = (await safeReadDir(pluginPath)).filter((e) => e.isDirectory())
      if (!versions.length) continue
      let latestDir = versions[0].name
      let latestMtime = 0
      for (const v of versions) {
        const meta = await statSafe(joinPath(pluginPath, v.name))
        if (meta.mtime! > latestMtime) {
          latestMtime = meta.mtime!
          latestDir = v.name
        }
      }
      const versionDir = joinPath(pluginPath, latestDir)
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
  const claudeDir = joinPath(homeDir(), '.claude')
  let installed: Record<string, any> = {}
  let enabled: Record<string, any> = {}
  try {
    const raw = await readFile(joinPath(claudeDir, 'plugins', 'installed_plugins.json'), 'utf8')
    installed = JSON.parse(raw).plugins || {}
  } catch {
    return []
  }
  try {
    const raw = await readFile(joinPath(claudeDir, 'settings.json'), 'utf8')
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
  const dir = joinPath(homeDir(), '.claude', 'skills')
  return { skills: await scanSkillsFlatDir(dir, 'user', 'user', opts), agents: [] }
}

export async function scanUserAgents(): Promise<ScanResult> {
  const dir = joinPath(homeDir(), '.claude', 'agents')
  return { skills: [], agents: await scanAgentsInDir(dir, 'user', 'user') }
}

export async function scanCursorSkills(opts: ScanOpts = {}): Promise<ScanResult> {
  const dir = joinPath(homeDir(), '.cursor', 'skills-cursor')
  return { skills: await scanSkillsFlatDir(dir, 'cursor', 'cursor', opts), agents: [] }
}

export async function scanProjectClaude(projectRoot: string, opts: ScanOpts = {}): Promise<ScanResult> {
  const skills = await scanSkillsFlatDir(joinPath(projectRoot, '.claude', 'skills'), 'project', 'project', opts)
  const agents = await scanAgentsInDir(joinPath(projectRoot, '.claude', 'agents'), 'project', 'project')
  return { skills, agents }
}

export async function latestPluginCacheDir(pluginName: string): Promise<string | null> {
  const cacheRoot = joinPath(homeDir(), '.claude', 'plugins', 'cache')
  for (const market of await safeReadDir(cacheRoot)) {
    if (!market.isDirectory()) continue
    const pluginPath = joinPath(cacheRoot, market.name, pluginName)
    const versions = (await safeReadDir(pluginPath)).filter((e) => e.isDirectory())
    if (!versions.length) continue
    let latestDir = versions[0].name
    let latestMtime = 0
    for (const v of versions) {
      const meta = await statSafe(joinPath(pluginPath, v.name))
      if (meta.mtime! > latestMtime) {
        latestMtime = meta.mtime!
        latestDir = v.name
      }
    }
    return joinPath(pluginPath, latestDir)
  }
  return null
}
