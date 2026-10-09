export {
  ensureNlChatBuilderAgent,
  scanCustomAgents,
  // fallow-ignore-next-line unused-export
  listPipelineProfileNames,
} from '../../agent-editor/business/index.js'
export { buildCatalog } from '../../pipeline-editor/business/catalog/index.js'
// fallow-ignore-next-line unused-type
export type { CatalogScanPatterns } from '../../pipeline-editor/business/catalog/index.js'
export { loadScanPatternsConfig } from '../../settings/business/index.js'
// xem docs/architecture/code/nl-chat.md §10
// fallow-ignore-next-line unused-export
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
export type { NlChatEntityType } from './nlChatSession.js'

export { saveChatAttachments, checkAttachmentLimits } from './chatAttachments.js'
export type { IncomingAttachment } from './chatAttachments.js'

// fallow-ignore-next-line unused-export
export { buildNlChatCatalog, renderNlChatCatalog } from './nlChatCatalog.js'
// fallow-ignore-next-line unused-type
export type { NlChatCatalog } from './nlChatCatalog.js'
