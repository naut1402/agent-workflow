import { AbstractBusiness } from '../../../core/business/AbstractBusiness.js'
import { getKnowledgeDriver, loadKnowledgeConfig } from './fileDriver.js'
import { handleKnowledgeApi } from './knowledgeApi.js'

/** Facade knowledge — HTTP node-res vẫn qua handleKnowledgeApi. */
export class KnowledgeBusiness extends AbstractBusiness {
  getDriver() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate
    return getKnowledgeDriver(gate.root)
  }

  loadConfig() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate
    return loadKnowledgeConfig(gate.root)
  }
}

export {
  getKnowledgeDriver,
  loadKnowledgeConfig,
  createFileDriver,
  knowledgeRoot,
  loadKnowledgeBundle,
} from './fileDriver.js'
export { handleKnowledgeApi } from './knowledgeApi.js'
