import { joinPath } from '../../../../../backend/lib/fileHelper.js'
import type { CatalogContext, CatalogSource, ScanResult } from '../CatalogSource.js'

/** Nguồn `dashboard`: Adapter bọc kho agent do dashboard quản lý, đi qua port `CatalogAgentStore`. */
export class CustomAgentSource implements CatalogSource {
  readonly priority = 55

  owns(source: string): boolean {
    return source === 'dashboard'
  }

  async scan(ctx: CatalogContext): Promise<ScanResult> {
    const scanCustomAgents = ctx.agentStore.scanCustomAgents
    return { skills: [], agents: scanCustomAgents ? await scanCustomAgents(ctx.root) : [] }
  }

  async resolveAgentPath(ctx: CatalogContext, _source: string, name: string): Promise<string | null> {
    const customAgentsDir = ctx.agentStore.customAgentsDir
    return customAgentsDir ? joinPath(customAgentsDir(ctx.root), `${name}.md`) : null
  }
}
