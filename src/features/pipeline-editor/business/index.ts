/**
 * Public business surface for pipeline-editor.
 * Cross-feature deps live here; other modules in this feature import peers via index.
 */

export { sanitiseProfileName } from './pipeline/index.js'
/** Peer: `steps[].runner_id` là khoá tra registry lúc execute (owned by runner). */
export { sanitiseRunnerId } from '../../runner/business/index.js'
export { loadScanPatternsConfig } from '../../settings/business/index.js'
export * from '../../agent-editor/business/index.js'
/** Bề mặt catalog cho feature khác (nl-chat) — đi qua barrel, không import sâu `catalog/`. */
export { buildCatalog } from './catalog/index.js'
// fallow-ignore-next-line unused-type
export type { Catalog, CatalogAgentStore, CatalogScanPatterns } from './catalog/index.js'
