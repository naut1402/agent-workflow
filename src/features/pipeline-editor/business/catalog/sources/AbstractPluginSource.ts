import { joinPath } from '../../../../../backend/lib/fileHelper.js'
import { scanAgentsInDir, scanSkillsFlatDir, type ScanOpts } from '../catalogMarkdown.js'
import type { CatalogContext, CatalogSource, ScanResult } from '../CatalogSource.js'

/** Một plugin tìm thấy: tên ghép vào `source` và thư mục chứa `skills/` + `agents/`. */
export interface PluginLocation {
  name: string
  dir: string
}

/**
 * Template Method cho các nguồn plugin: liệt kê plugin → quét từng thư mục
 * plugin; resolve = tìm thư mục plugin theo tên → ghép path trong plugin.
 * Hiện thực chỉ trả lời "plugin nằm ở đâu" và tiền tố `source` của mình.
 */
export abstract class AbstractPluginSource implements CatalogSource {
  abstract readonly priority: number
  /** Tiền tố trường `source` của item, item có `source` = tiền tố + tên plugin. */
  protected abstract readonly prefix: string

  protected abstract listPlugins(ctx: CatalogContext): Promise<PluginLocation[]>
  /** Thư mục của plugin `pluginName`, hoặc null để nhường nguồn kế tiếp. */
  protected abstract findPluginDir(ctx: CatalogContext, pluginName: string): Promise<string | null>

  owns(source: string): boolean {
    return source.startsWith(this.prefix)
  }

  async scan(ctx: CatalogContext): Promise<ScanResult> {
    const skills: any[] = []
    const agents: any[] = []
    for (const plugin of await this.listPlugins(ctx)) {
      try {
        const found = await scanPlugin(plugin.dir, `${this.prefix}${plugin.name}`, plugin.name)
        skills.push(...found.skills)
        agents.push(...found.agents)
      } catch {
        /* skip broken plugin */
      }
    }
    return { skills, agents }
  }

  async resolveAgentPath(ctx: CatalogContext, source: string, name: string): Promise<string | null> {
    const dir = await this.findPluginDir(ctx, this.pluginNameOf(source))
    return dir ? joinPath(dir, 'agents', `${name}.md`) : null
  }

  async resolveSkillPath(ctx: CatalogContext, source: string, name: string): Promise<string | null> {
    const dir = await this.findPluginDir(ctx, this.pluginNameOf(source))
    return dir ? joinPath(dir, 'skills', name, 'SKILL.md') : null
  }

  protected pluginNameOf(source: string): string {
    return source.slice(this.prefix.length)
  }
}

/** Scan a plugin directory: `skills/<x>/SKILL.md` and `agents/<name>.md`. */
export async function scanPlugin(
  pluginDir: string,
  source: string,
  pluginLabel: string,
  opts: ScanOpts = {},
): Promise<ScanResult> {
  return {
    skills: await scanSkillsFlatDir(joinPath(pluginDir, 'skills'), source, pluginLabel, opts),
    agents: await scanAgentsInDir(joinPath(pluginDir, 'agents'), source, pluginLabel),
  }
}
