import { AbstractBusiness } from '../../../backend/business/AbstractBusiness.js'
import { getKnowledgeDriver, loadKnowledgeConfig } from './knowledgeDriverRegistry.js'

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

export { getKnowledgeDriver, loadKnowledgeConfig } from './knowledgeDriverRegistry.js'
export {
  listKnowledge,
  listKnowledgeWithTags,
  listKnowledgeTags,
  loadKnowledgeBundle,
} from './knowledgeEntries.js'
export { KnowledgeDbError, knowledgeRoot } from './knowledgeDb.js'
export { migrateKnowledgeToSqlite } from './collectionsYaml.js'
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
