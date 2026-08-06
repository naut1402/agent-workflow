/** Peer: advance task phase after a successful pipeline job (owned by monitor). */
export { advanceStepOnJobSuccess, queuePendingFeedback, takePendingFeedback } from '../../monitor/business/tasks/state.js'
export type { PendingFeedback } from '../../monitor/business/tasks/state.js'
/** Peer: layered pipeline config (owned by pipeline-editor). */
export { loadPipelineConfig } from '../../pipeline-editor/business/pipeline/index.js'

export {
  loadRunners,
  saveRunners,
  listRunners,
  getRunner,
  getDefaultRunner,
  upsertRunner,
  deleteRunner,
  setDefaultRunner,
  substituteConfig,
  normalizeRunner,
} from './registry.js'
export {
  loadCredentials,
  saveCredentials,
  listCredentials,
  getCredential,
  upsertCredential,
  deleteCredential,
  resolveSecretRef,
} from './credentials.js'
export {
  loadConnections,
  saveConnections,
  listConnections,
  getConnection,
  upsertConnection,
  deleteConnection,
  ensureLegacyConnection,
  listProviderCatalog,
  scanLocalCommands,
} from './connections.js'
export { resolveAgent, resolveAgentFilePath, normalizeAgentRef } from './agentResolver.js'
export { getProvider, listProviderIds, registerProvider } from './registry.js'
export {
  submitJob,
  submitAndWait,
  loadJob,
  listJobs,
  cancelJob,
  submitApprovalJob,
  sendJobFeedback,
  sendTaskFeedback,
  getApprovalDiff,
  approveJob,
  discardJob,
  findSelectionRange,
  extractLines,
  stepIdOf,
} from './jobQueue.js'
export { reapOrphanedRunningJobs, isPidAlive } from './jobQueue.js'
export {
  loadTaskSessionLedger,
  resolveSessionPlan,
  recordSessionUsage,
  isSessionEntryValid,
  closeTaskSession,
} from './sessionLedger.js'
export type { SessionEntry, TaskSessionLedger, SessionEntryStatus } from './sessionLedger.js'
export {
  parseCursorJsonOutput,
  buildCursorJsonArgs,
  prepareSessionInvocation,
  mintSessionId,
} from './sessionLedger.js'

export type {
  CredentialProfile,
  Connection,
  ConnectionKind,
  ProviderCatalogEntry,
  ScannedCommand,
  RunnerConfig,
  ResolvedAgent,
  ExecuteRequest,
  ExecuteResult,
  JobStatus,
  JobRecord,
  RunnerProvider,
  MutationResult,
} from './types.js'
