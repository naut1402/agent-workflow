import {
  basename,
  dirname,
  joinPath,
  readTextFile,
  resolvePath,
  resolvePathUnder,
  statSafe,
} from '../../../../../backend/lib/fileHelper.js'
import type { CatalogContext } from '../CatalogSource.js'
import { AbstractPluginSource, type PluginLocation } from './AbstractPluginSource.js'
import { loadEnabledPluginInstalls } from './InstalledPluginSource.js'

/**
 * Nguồn `repo:<name>` từ `.claude-plugin/marketplace.json` của repo project.
 * Có plugin nào đã cài thì chỉ giữ plugin repo trùng tên với một install đang bật.
 */
export class RepoPluginSource extends AbstractPluginSource {
  readonly priority = 40
  protected readonly prefix = 'repo:'

  protected async listPlugins(ctx: CatalogContext): Promise<PluginLocation[]> {
    const found = await findMarketplaceJson(ctx.projectRoot)
    if (!found) return []
    const installs = await loadEnabledPluginInstalls()
    const enabledNames = installs.length ? new Set(installs.map((i) => i.name)) : null
    const plugins: PluginLocation[] = []
    for (const p of marketplacePlugins(found.data)) {
      if (!p.source) continue
      const name = p.name || basename(p.source)
      if (enabledNames && !enabledNames.has(name)) continue
      plugins.push({ name, dir: resolvePath(found.dir, p.source) })
    }
    return plugins
  }

  protected async findPluginDir(ctx: CatalogContext, pluginName: string): Promise<string | null> {
    const found = await findMarketplaceJson(ctx.projectRoot)
    if (!found) return null
    const hit = marketplacePlugins(found.data).find((p: any) => (p.name || basename(p.source)) === pluginName)
    if (!hit?.source) return null
    return resolvePath(found.dir, hit.source)
  }

  /**
   * Fallback `<projectRoot>/plugins/<plugin>/agents/<name>.md` khi marketplace.json
   * không cho ra file. Tách khỏi chuỗi resolve: chỉ route xem nội dung gọi tới.
   *
   * ⚠️ Không sanitise `pluginName` — giữ nguyên hành vi có sẵn của route agent
   * (#447 chỉ dời code, không đổi hành vi); khe traversal sẽ vá ở issue riêng.
   */
  async fallbackAgentPath(projectRoot: string, source: string, name: string): Promise<string | null> {
    if (!this.owns(source)) return null
    const file = joinPath(projectRoot, 'plugins', this.pluginNameOf(source), 'agents', `${name}.md`)
    return (await statSafe(file)).exists ? file : null
  }

  /**
   * Fallback `<projectRoot>/plugins/<plugin>/skills/<name>/SKILL.md`. Cả `name` lẫn
   * `pluginName` phải qua whitelist ký tự (AGENTS.md §4), nếu không
   * `repo:../../..:x` thoát khỏi `plugins/`; `resolvePathUnder` là lớp chặn thứ hai.
   */
  async fallbackSkillPath(
    projectRoot: string,
    source: string,
    name: string,
    sanitiseName: (name: string) => string | null,
  ): Promise<string | null> {
    if (!this.owns(source) || sanitiseName(name) !== name) return null
    const pluginName = this.pluginNameOf(source)
    if (sanitiseName(pluginName) !== pluginName) return null
    const file = resolvePathUnder(resolvePath(projectRoot, 'plugins'), pluginName, 'skills', name, 'SKILL.md')
    if (!file) return null
    return (await statSafe(file)).exists ? file : null
  }
}

function marketplacePlugins(data: any): any[] {
  return Array.isArray(data.plugins) ? data.plugins : []
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
