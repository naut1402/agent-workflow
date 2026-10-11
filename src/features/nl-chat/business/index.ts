/**
 * Public business surface for nl-chat.
 * Cross-feature deps are re-exported here; other modules import peers via index.
 *
 * Fallow không lần được consumer qua barrel này (cùng lý do đã ghi ở
 * `pipeline-editor/business/index.ts`), nên mọi named re-export dưới đây đọc ra
 * như code chết trong khi `controller.ts` và `nlChatCatalog.ts` đang dùng thật.
 */

export {
  ensureNlChatBuilderAgent,
  scanCustomAgents,
  listPipelineProfileNames,
} from '../../agent-editor/business/index.js'
export { buildCatalog } from '../../pipeline-editor/business/index.js'
export type { CatalogScanPatterns } from '../../pipeline-editor/business/index.js'
export { loadScanPatternsConfig } from '../../settings/business/index.js'
// Barrel `automations/business` thuần (không side effect) nhưng kéo module
// chỉ chạy trên server — đừng import module này từ code FE.
export { listAutomations, KNOWN_AUTOMATION_EVENT_TYPES } from '../../automations/business/index.js'
export type { AutomationActionKind } from '../../automations/business/index.js'
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
export type { NlChatEntityType } from './nlChatSession.js'

// Only what the controller consumes; the rest of `chatAttachments` is internal
// to the module and its tests import it directly.
export { saveChatAttachments, checkAttachmentLimits } from './chatAttachments.js'
export type { IncomingAttachment } from './chatAttachments.js'

export { buildNlChatCatalog, renderNlChatCatalog } from './nlChatCatalog.js'
// fallow-ignore-next-line unused-type
export type { NlChatCatalog } from './nlChatCatalog.js'
