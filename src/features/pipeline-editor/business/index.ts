/**
 * Public business surface for pipeline-editor.
 * Cross-feature deps live here; other modules in this feature import peers via index.
 */

export { sanitiseProfileName } from './pipeline/index.js'
export { profilesDir, customAgentsDir } from '../../agent-editor/business/paths.js'
export { scanCustomAgents } from '../../agent-editor/business/store.js'
