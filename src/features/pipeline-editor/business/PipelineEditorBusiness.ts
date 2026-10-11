import { AbstractBusiness } from '../../../backend/business/AbstractBusiness.js'
import { dirname, readTextFile } from '../../../backend/lib/fileHelper.js'
import { parseFrontmatter } from '../../../backend/lib/yamlLib.js'
import {
  buildCatalog,
  parseCatalogItemId,
  resolveCatalogAgentPath,
  resolveCatalogSkillPath,
  resolveRepoFallbackAgentPath,
  resolveRepoFallbackSkillPath,
  type CatalogAgentStore,
} from './catalog/index.js'
import {
  customAgentsDir,
  draftFromAgentMarkdown,
  globalAgentsDir,
  loadScanPatternsConfig,
  sanitiseAgentName,
  scanCustomAgents,
} from './index.js'

/**
 * Facade của pipeline-editor cho controller: lắp port `CatalogAgentStore` từ
 * agent-editor và scan patterns từ settings vào catalog, trả data thuần hoặc
 * `{ status, error }` — controller chỉ map HTTP.
 */
export class PipelineEditorBusiness extends AbstractBusiness {
  async getCatalog() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate
    return buildCatalog(gate.root, { ...catalogAgentStore(), scanPatterns: loadScanPatternsConfig() })
  }

  /** Nội dung + draft của một agent trong catalog, kể cả fallback `plugins/` của id `repo:`. */
  async getCatalogAgent(id: string) {
    const gate = this.requireRoot()
    if ('error' in gate) return gate
    const { root } = gate
    const projectRoot = dirname(root)
    const agentPath =
      (await resolveCatalogAgentPath(projectRoot, root, id, {
        ...catalogAgentStore(),
        scanPatterns: loadScanPatternsConfig().agents,
      })) ?? (await resolveRepoFallbackAgentPath(projectRoot, id, sanitiseAgentName))
    if (!agentPath) return this.notFound('agent file not found')
    try {
      const raw = await readTextFile(agentPath)
      const meta = parseCatalogItemId(id)
      const draft = draftFromAgentMarkdown(raw, { name: meta?.name, description: '' })
      const fm = parseFrontmatter(raw)
      if (fm.description) draft.description = fm.description
      if (Array.isArray(fm.skills) && fm.skills.length) draft.skills = [...fm.skills]
      return { id, path: agentPath, content: raw, draft }
    } catch (e: any) {
      if (e?.code === 'ENOENT') return this.notFound('agent file not found')
      return this.fail(500, String(e.message || e))
    }
  }

  /** Nội dung `SKILL.md` của một skill trong catalog, kể cả fallback `plugins/` của id `repo:`. */
  async getSkillContent(id: string) {
    const gate = this.requireRoot()
    if ('error' in gate) return gate
    const projectRoot = dirname(gate.root)
    const skillPath =
      (await resolveCatalogSkillPath(projectRoot, id, {
        sanitiseName: sanitiseAgentName,
        scanPatterns: loadScanPatternsConfig().skills,
      })) ?? (await resolveRepoFallbackSkillPath(projectRoot, id, sanitiseAgentName))
    if (!skillPath) return this.notFound('skill file not found')
    try {
      return { id, content: await readTextFile(skillPath) }
    } catch (e: any) {
      return this.fail(500, String(e.message || e))
    }
  }
}

/** Adapter của port `CatalogAgentStore` trên kho agent của agent-editor. */
function catalogAgentStore(): CatalogAgentStore {
  return { scanCustomAgents, customAgentsDir, userAgentsDir: globalAgentsDir }
}
