import { AbstractBusiness } from '../../../core/business/AbstractBusiness.js'
import { buildCatalog, parseCatalogAgentId, resolveCatalogAgentPath } from './catalog/index.js'
import { buildRules } from './rules/index.js'
import { loadPipelineConfig, knownArtifactsFor } from './pipeline/index.js'
import { profilesDir, scanCustomAgents, customAgentsDir } from './index.js'

export class PipelineEditorBusiness extends AbstractBusiness {
  async getCatalog() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate
    return buildCatalog(gate.root, { scanCustomAgents })
  }

  async getRules() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate
    return buildRules(gate.root)
  }

  profilesDir() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate
    return { root: gate.root, dir: profilesDir(gate.root) }
  }

  customAgentsDir() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate
    return { root: gate.root, dir: customAgentsDir(gate.root) }
  }
}

export {
  buildCatalog,
  parseCatalogAgentId,
  resolveCatalogAgentPath,
  buildRules,
  loadPipelineConfig,
  knownArtifactsFor,
  profilesDir,
  scanCustomAgents,
  customAgentsDir,
}
