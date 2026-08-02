/** Priority of a catalog source when deduping items with the same name. */
export function sourcePriority(source: string): number {
  if (source === 'dashboard') return 55
  if (source === 'project') return 50
  if (source === 'user') return 20
  if (source === 'cursor') return 10
  if (typeof source === 'string' && source.startsWith('repo:')) return 40
  if (typeof source === 'string' && source.startsWith('plugin:')) return 45
  return 0
}

/**
 * Dedupe catalog items by `name`, keeping the highest-priority source, then
 * sort by name. Pure — the core of catalog source precedence.
 */
export function dedupeCatalogItems<T extends { name: string; source: string }>(items: T[]): T[] {
  const byName = new Map<string, T>()
  for (const item of items) {
    const existing = byName.get(item.name)
    if (!existing || sourcePriority(item.source) > sourcePriority(existing.source)) {
      byName.set(item.name, item)
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// Built-in fallback catalog when no skills/agents are discovered on disk
// (e.g. marketplace.json not found and no installed plugins).
export const BUILTIN_CATALOG = {
  skills: [
    { id: 'repo:dev-agent-teams:survey-codebase', name: 'survey-codebase', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Survey codebase, trace call chains' },
    { id: 'repo:dev-agent-teams:write-design', name: 'write-design', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Write design documentation' },
    { id: 'repo:dev-agent-teams:coding-rules', name: 'coding-rules', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Apply coding conventions' },
    { id: 'repo:dev-agent-teams:run-phpstan', name: 'run-phpstan', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Run PHPStan static analysis' },
    { id: 'repo:dev-agent-teams:write-tests', name: 'write-tests', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Write test specifications' },
    { id: 'repo:dev-agent-teams:create-pr', name: 'create-pr', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Create pull request' },
    { id: 'repo:dev-agent-teams:doc-review', name: 'doc-review', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Review documentation quality' },
  ],
  agents: [
    { id: 'repo:dev-agent-teams:investigator', name: 'investigator', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Survey codebase, trace call chains from entry point', skills: ['survey-codebase'] },
    { id: 'repo:dev-agent-teams:designer', name: 'designer', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Write design documentation', skills: ['write-design'] },
    { id: 'repo:dev-agent-teams:implementer', name: 'implementer', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Implement code changes, run PHPStan', skills: ['coding-rules', 'run-phpstan'] },
    { id: 'repo:dev-agent-teams:reviewer', name: 'reviewer', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Review code quality, create test spec', skills: ['coding-rules', 'write-tests'] },
    { id: 'repo:dev-agent-teams:pr-creator', name: 'pr-creator', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Create PR description, amend commit', skills: ['create-pr'] },
    { id: 'repo:dev-agent-teams:doc-reviewer', name: 'doc-reviewer', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Review document quality', skills: ['doc-review'] },
  ],
}

import { basename, dirname, homeDir, joinPath, resolvePath } from '../../../../core/lib/fileHelper.js'
import {
  findMarketplaceJson,
  latestPluginCacheDir,
  loadEnabledPluginInstalls,
  scanCursorSkills,
  scanEnabledInstalledPlugins,
  scanPluginCache,
  scanProjectClaude,
  scanRepoPlugins,
  scanUserAgents,
  scanUserSkills,
  type ScanResult,
} from './scan.js'


export interface Catalog {
  skills: any[]
  agents: any[]
}

/**
 * Aggregate skills + agents from every source, dedupe by name (source priority),
 * fall back to BUILTIN_CATALOG when nothing is found.
 *
 * `deps.scanCustomAgents` is injected (it belongs to the agents module) so the
 * catalog module stays decoupled from agents.
 */
export async function buildCatalog(
  root: string,
  deps: { scanCustomAgents: (root: string) => Promise<any[]> },
): Promise<Catalog> {
  const projectRoot = dirname(root)
  const catalogOpts = { includeContractSkills: true }
  const enabledInstalls = await loadEnabledPluginInstalls()
  const enabledPluginNames = enabledInstalls.length
    ? new Set(enabledInstalls.map((i) => i.name))
    : null

  const batches: ScanResult[] = [
    await scanEnabledInstalledPlugins(),
    await scanCursorSkills(catalogOpts),
    await scanUserSkills(catalogOpts),
    await scanUserAgents(),
    { skills: [], agents: await deps.scanCustomAgents(root) },
    ...(enabledInstalls.length ? [] : [await scanPluginCache(catalogOpts)]),
    await scanRepoPlugins(projectRoot, {
      ...catalogOpts,
      enabledPluginNames: enabledPluginNames || undefined,
    }),
    await scanProjectClaude(projectRoot, catalogOpts),
  ]

  const allSkills: any[] = []
  const allAgents: any[] = []
  for (const b of batches) {
    allSkills.push(...(b.skills || []))
    allAgents.push(...(b.agents || []))
  }

  const skills = dedupeCatalogItems(allSkills)
  const agents = dedupeCatalogItems(allAgents)

  if (!skills.length && !agents.length) {
    return { skills: BUILTIN_CATALOG.skills, agents: BUILTIN_CATALOG.agents }
  }

  return { skills, agents }
}

export function parseCatalogAgentId(id: unknown): { source: string; name: string } | null {
  if (typeof id !== 'string' || !id.includes(':')) return null
  const i = id.lastIndexOf(':')
  if (i <= 0) return null
  return { source: id.slice(0, i), name: id.slice(i + 1) }
}

/**
 * Resolve the on-disk path of a catalog agent's markdown by its catalog id.
 * `deps.customAgentsDir` is injected (agents module) to keep catalog decoupled.
 */
export async function resolveCatalogAgentPath(
  projectRoot: string,
  root: string,
  id: string,
  deps: { customAgentsDir: (root: string) => string },
): Promise<string | null> {
  const parsed = parseCatalogAgentId(id)
  if (!parsed?.name) return null
  const { source, name } = parsed
  const fileName = `${name}.md`

  if (source === 'dashboard') {
    return joinPath(deps.customAgentsDir(root), fileName)
  }
  if (source === 'user') {
    return joinPath(homeDir(), '.claude', 'agents', fileName)
  }
  if (source === 'project') {
    return joinPath(projectRoot, '.claude', 'agents', fileName)
  }
  if (source.startsWith('repo:')) {
    const pluginName = source.slice('repo:'.length)
    const found = await findMarketplaceJson(projectRoot)
    if (!found) return null
    const plugins = Array.isArray(found.data.plugins) ? found.data.plugins : []
    const hit = plugins.find((p: any) => (p.name || basename(p.source)) === pluginName)
    if (!hit?.source) return null
    return joinPath(resolvePath(found.dir, hit.source), 'agents', fileName)
  }
  if (source.startsWith('plugin:')) {
    const pluginName = source.slice('plugin:'.length)
    const installs = await loadEnabledPluginInstalls()
    const install = installs.find((i) => i.name === pluginName)
    if (install?.installPath) {
      return joinPath(install.installPath, 'agents', fileName)
    }
    const cacheDir = await latestPluginCacheDir(pluginName)
    if (cacheDir) return joinPath(cacheDir, 'agents', fileName)
  }
  return null
}
