/**
 * Public business surface for pipeline-editor.
 * Cross-feature deps live here; other modules in this feature import peers via index.
 */

export { sanitiseProfileName } from './pipeline/index.js'
// Fallow cannot resolve consumers of this barrel — the `export *` below hides them, so every
// named re-export here reads as dead. `sanitiseProfileName` above is reported the same way
// while `controller.ts` calls it in three places; both are false positives.
// fallow-ignore-next-line unused-export
export { loadScanPatternsConfig } from '../../settings/business/index.js'
export * from '../../agent-editor/business/index.js'
