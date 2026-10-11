import { homeDir, joinPath, safeReadDir, statSafe } from '../../../../../backend/lib/fileHelper.js'
import type { CatalogContext } from '../CatalogSource.js'
import { AbstractPluginSource, type PluginLocation } from './AbstractPluginSource.js'
import { loadEnabledPluginInstalls } from './InstalledPluginSource.js'

/**
 * Nguồn `plugin:<name>` từ `~/.claude/plugins/cache`, bản mới nhất theo mtime.
 * Chỉ quét khi chưa có plugin nào cài; resolve thì luôn là phương án sau install.
 */
export class PluginCacheSource extends AbstractPluginSource {
  readonly priority = 45
  protected readonly prefix = 'plugin:'

  protected async listPlugins(): Promise<PluginLocation[]> {
    if ((await loadEnabledPluginInstalls()).length) return []
    const root = cacheRoot()
    const plugins: PluginLocation[] = []
    for (const market of await safeReadDir(root)) {
      if (!market.isDirectory()) continue
      const marketPath = joinPath(root, market.name)
      for (const plugin of await safeReadDir(marketPath)) {
        if (!plugin.isDirectory()) continue
        const dir = await latestVersionDir(joinPath(marketPath, plugin.name))
        if (dir) plugins.push({ name: plugin.name, dir })
      }
    }
    return plugins
  }

  protected async findPluginDir(_ctx: CatalogContext, pluginName: string): Promise<string | null> {
    return latestPluginCacheDir(pluginName)
  }
}

function cacheRoot(): string {
  return joinPath(homeDir(), '.claude', 'plugins', 'cache')
}

/** Thư mục phiên bản có mtime mới nhất của một plugin trong cache; null khi chưa có phiên bản nào. */
async function latestVersionDir(pluginPath: string): Promise<string | null> {
  const versions = (await safeReadDir(pluginPath)).filter((e) => e.isDirectory())
  if (!versions.length) return null
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

/** Bản cache mới nhất của `pluginName` ở marketplace đầu tiên có nó. */
export async function latestPluginCacheDir(pluginName: string): Promise<string | null> {
  const root = cacheRoot()
  for (const market of await safeReadDir(root)) {
    if (!market.isDirectory()) continue
    const dir = await latestVersionDir(joinPath(root, market.name, pluginName))
    if (dir) return dir
  }
  return null
}
