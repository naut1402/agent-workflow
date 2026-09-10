/**
 * Public business surface for nl-chat.
 * Cross-feature deps are re-exported here; other modules import peers via index.
 */

export {
  ensureNlChatBuilderAgent,
  scanCustomAgents,
  listPipelineProfileNames,
} from '../../agent-editor/business/index.js'
export { buildCatalog } from '../../pipeline-editor/business/catalog/index.js'
export type { CatalogScanPatterns } from '../../pipeline-editor/business/catalog/index.js'
export { loadScanPatternsConfig } from '../../settings/business/index.js'
// Barrel `automations/business` khởi động scheduler/event-trigger ở top-level
// (chắn bằng `!process.env.BUN_TEST`) — an toàn ở đây vì không file FE nào
// import `nl-chat/business/**`. Đừng import module này từ code FE.
export { listAutomations } from '../../automations/business/index.js'
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

// Only what the controller consumes; the rest of `chatAttachments` is internal
// to the module and its tests import it directly.
export { saveChatAttachments, checkAttachmentLimits } from './chatAttachments.js'
export type { IncomingAttachment } from './chatAttachments.js'

export { buildNlChatCatalog, renderNlChatCatalog } from './nlChatCatalog.js'
export type { NlChatCatalog } from './nlChatCatalog.js'
