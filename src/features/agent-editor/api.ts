// Facade `api` cho agent-editor — agent CRUD + NL build (issue #159 Việc 2+).
import {
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
} from '../../api/resources/agents'
import { fetchCatalog, fetchCatalogAgent } from '../../api/resources/catalog'
import { fetchJob } from '../../api/resources/jobs'
import { fetchRunners } from '../../api/resources/runners'

export const agentEditorApi = {
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
  fetchCatalog,
  fetchCatalogAgent,
  fetchJob,
  fetchRunners,
}
