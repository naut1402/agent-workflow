import { AbstractBusiness } from '../../../backend/business/AbstractBusiness.js'
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
export { KnowledgeDbError } from './knowledgeDb.js'
export {
  listCollections,
  createCollection,
  updateCollection,
  deleteCollection,
  findCollectionSafe,
  renameTag,
  resolveCollectionEntries,
} from './collections.js'
export type { KnowledgeCollection } from './collections.js'
export { createTag, updateTag, listTagMeta, decorateTagFacets } from './tags.js'
export type { KnowledgeTagMeta, KnowledgeTagFacet } from './tags.js'
