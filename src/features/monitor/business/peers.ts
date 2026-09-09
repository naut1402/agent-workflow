/**
 * Peer re-exports for monitor `tasks/*` (and other internal modules).
 *
 * Controllers / public surface keep using `./index.js`. This thinner barrel
 * avoids evaluating runner + cloneProject (`node:child_process`) when only
 * pipeline/profile peers are needed — important if a tasks module is ever
 * pulled into the Vite client graph.
 */

export {
  loadPipelineConfig,
  knownArtifactsFor,
  sanitiseProfileName,
} from '../../pipeline-editor/business/pipeline/index.js'
export { profilesDir } from '../../agent-editor/business/agents.js'
