import { AbstractBusiness } from '../../../core/business/AbstractBusiness.js'
import { getKnowledgeDriver, loadKnowledgeConfig } from './fileDriver.js'

/** Facade knowledge — HTTP đi qua `api.ts` + `controller.ts` như mọi feature. */
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
export { CollectionsFileError } from './collections.js'
export {
  listCollections,
  createCollection,
  updateCollection,
  deleteCollection,
  renameTag,
  resolveCollectionEntries,
} from './collections.js'
export type { KnowledgeCollection, CollectionsDoc } from './collections.js'
