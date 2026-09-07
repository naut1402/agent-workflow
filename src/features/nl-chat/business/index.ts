/**
 * Public business surface for nl-chat.
 * Cross-feature deps are re-exported here; other modules import peers via index.
 */

export {
  ensureNlChatBuilderAgent,
  scanCustomAgents,
} from '../../agent-editor/business/index.js'
export { buildCatalog } from '../../pipeline-editor/business/catalog/index.js'
export { loadScanPatternsConfig } from '../../settings/business/index.js'
export {
  submitJob,
  sendTaskFeedback,
  listJobs,
  closeTaskSession,
} from '../../runner/business/index.js'
export type { JobRecord, MutationResult } from '../../runner/business/index.js'

export {
  startNlChatSession,
  continueNlChatSession,
  getNlChatTurn,
  cancelNlChatSession,
  isNlChatSessionId,
} from './nlChatSession.js'
