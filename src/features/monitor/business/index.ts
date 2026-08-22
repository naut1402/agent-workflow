/**
 * Public business surface for monitor (controllers + cross-feature).
 * Cross-feature deps are re-exported here only — other modules in this feature
 * import peers through `./peers.js` (tasks) or `./index.js` (full surface),
 * never from another feature's business tree directly.
 */

export {
  loadPipelineConfig,
  knownArtifactsFor,
  sanitiseProfileName,
} from '../../pipeline-editor/business/pipeline/index.js'
export { profilesDir, fetchUrlSafe, isPrivateHostname } from '../../agent-editor/business/index.js'
export { loadGithubTokensConfig } from '../../settings/business/index.js'
export {
  submitJob,
  submitApprovalJob,
  sendTaskFeedback,
  findSelectionRange,
  extractLines,
  listJobs,
  stepIdOf,
} from '../../runner/business/index.js'
export { getRunner } from '../../runner/business/index.js'
export { getConnection } from '../../runner/business/index.js'
export { loadTaskSessionLedger, closeTaskSession, parseCursorJsonOutput } from '../../runner/business/index.js'
export type { SessionEntry, TaskSessionLedger } from '../../runner/business/index.js'
export type { JobRecord } from '../../runner/business/index.js'

export { resolveArtifact, runTaskStep, createTask } from './tasks/index.js'
export type { RunTaskStepInput, RunTaskStepResult } from './tasks/index.js'
export type { CreateTaskInput, CreateTaskResult, CreatedTask } from './tasks/index.js'
export { cloneProject, setProjectBranch } from './projects/index.js'
export type { CloneResult } from './projects/index.js'
