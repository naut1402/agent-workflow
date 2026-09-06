/**
 * Public business surface for pipeline-editor.
 * Cross-feature deps live here; other modules in this feature import peers via index.
 */

export { sanitiseProfileName } from './pipeline/index.js'
export { loadScanPatternsConfig } from '../../settings/business/index.js'
export * from '../../agent-editor/business/index.js'
