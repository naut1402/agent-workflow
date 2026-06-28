import path from 'node:path'
import { homeDir } from '../../shared/fs.js'
import { dedupeCatalogItems } from './dedupe.js'
import { BUILTIN_CATALOG } from './builtins.js'
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

export { sourcePriority, dedupeCatalogItems } from './dedupe.js'
export { BUILTIN_CATALOG } from './builtins.js'

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
  const projectRoot = path.dirname(root)
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
    return path.join(deps.customAgentsDir(root), fileName)
  }
  if (source === 'user') {
    return path.join(homeDir(), '.claude', 'agents', fileName)
  }
  if (source === 'project') {
    return path.join(projectRoot, '.claude', 'agents', fileName)
  }
  if (source.startsWith('repo:')) {
    const pluginName = source.slice('repo:'.length)
    const found = await findMarketplaceJson(projectRoot)
    if (!found) return null
    const plugins = Array.isArray(found.data.plugins) ? found.data.plugins : []
    const hit = plugins.find((p: any) => (p.name || path.basename(p.source)) === pluginName)
    if (!hit?.source) return null
    return path.join(path.resolve(found.dir, hit.source), 'agents', fileName)
  }
  if (source.startsWith('plugin:')) {
    const pluginName = source.slice('plugin:'.length)
    const installs = await loadEnabledPluginInstalls()
    const install = installs.find((i) => i.name === pluginName)
    if (install?.installPath) {
      return path.join(install.installPath, 'agents', fileName)
    }
    const cacheDir = await latestPluginCacheDir(pluginName)
    if (cacheDir) return path.join(cacheDir, 'agents', fileName)
  }
  return null
}
