// Barrel: FE HTTP clients colocated dưới features/*/client.ts.
// Import cũ `from '../api'` / `from './client'` vẫn ổn định qua đây.

export { qs, apiFetch } from './http'

export {
  fetchProjects,
  fetchProject,
  addProject,
  removeProject,
  browseFs,
  fetchAutoscanConfig,
  saveAutoscanConfig,
  runAutoscan,
  fetchGithubTokensConfig,
  saveGithubTokensConfig,
} from '../features/settings/client'

export {
  fetchTasks,
  patchTaskState,
  patchTaskArchive,
  deleteTask,
  runPipelineStep,
  fetchTaskChat,
  sendTaskFeedback,
  fetchArtifact,
  saveArtifact,
  fetchArtifactActions,
  runArtifactAction,
  fetchPipelineExport,
  fetchFlowProfile,
  saveFlowProfile,
  createTask,
  fetchGithubIssue,
} from '../features/monitor/client'

export {
  fetchArtifactActionsCatalog,
  saveArtifactActionsCatalog,
} from '../features/quick-action/client'

export {
  fetchPipelineConfig,
  fetchCatalog,
  fetchCatalogAgent,
  fetchRules,
  fetchPipelineProfiles,
  fetchPipelineProfile,
  savePipelineProfile,
  deletePipelineProfile,
  writePipelineConfig,
} from '../features/pipeline-editor/client'

export {
  fetchCustomAgents,
  fetchCustomAgent,
  saveCustomAgent,
  deleteCustomAgent,
  exportCustomAgent,
  generateAgentDraft,
  fetchAgentTemplates,
  fetchAgentTemplate,
  saveAgentTemplate,
  importAgentTemplateUrl,
  uploadAgentTemplate,
  deleteAgentTemplate,
  fetchWorkflowStepTemplates,
  fetchWorkflowStepTemplate,
  saveWorkflowStepTemplate,
  deleteWorkflowStepTemplate,
  buildAndRunAgent,
} from '../features/agent-editor/client'
export type { BuildAndRunAgentInput, BuildAndRunAgentResult } from '../features/agent-editor/client'

export {
  fetchKnowledgeList,
  fetchKnowledgeEntry,
  createKnowledgeEntry,
  saveKnowledgeEntry,
  deleteKnowledgeEntry,
  fetchKnowledgeTags,
  uploadKnowledgeFile,
} from '../features/knowledge/client'

export {
  fetchRunners,
  saveRunner,
  deleteRunner,
  setDefaultRunner,
  fetchCredentials,
  saveCredential,
  fetchConnections,
  saveConnection,
  deleteConnection,
  scanLocalCommands,
  submitJob,
  fetchJob,
  fetchJobs,
  fetchProposal,
  approveJob,
  discardJob,
  sendActionFeedback,
} from '../features/runner/client'

export { fetchLogs, fetchJobLog } from '../features/logs/client'
export type { FetchJobLogOptions } from '../features/logs/client'

export {
  startNlChat,
  sendNlChatMessage,
  fetchNlChatTurn,
  cancelNlChat,
} from '../features/nl-chat/client'
