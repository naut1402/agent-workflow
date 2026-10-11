import { homeDir, joinPath, readFile } from '../../../../../backend/lib/fileHelper.js'
import type { CatalogContext } from '../CatalogSource.js'
import { AbstractPluginSource, type PluginLocation } from './AbstractPluginSource.js'

export interface PluginInstall {
  installPath: string
  pluginKey: string
  name: string
}

/** Nguồn `plugin:<name>` từ plugin Claude Code đã cài và đang bật. */
export class InstalledPluginSource extends AbstractPluginSource {
  readonly priority = 45
  protected readonly prefix = 'plugin:'

  protected async listPlugins(): Promise<PluginLocation[]> {
    return (await loadEnabledPluginInstalls()).map((i) => ({ name: i.name, dir: i.installPath }))
  }

  protected async findPluginDir(_ctx: CatalogContext, pluginName: string): Promise<string | null> {
    const install = (await loadEnabledPluginInstalls()).find((i) => i.name === pluginName)
    return install?.installPath || null
  }
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
