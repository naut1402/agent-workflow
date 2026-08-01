import { i18n } from '../../core/i18n'
import { apiGet, apiPost, apiRequest } from '../../api/http'
import { submitJob } from '../runner/RunnerApi'

export async function fetchCustomAgents() {
  return apiGet('/api/custom-agents')
}

export async function fetchCustomAgent(name: string) {
  return apiGet('/api/custom-agents', { name }, {
    errorMessage: (status) => `/api/custom-agents?name=${name} → ${status}`,
  })
}

export async function saveCustomAgent(draft: unknown, projectId?: string) {
  return apiPost('/api/custom-agents', { draft }, { query: { project: projectId } })
}

export async function deleteCustomAgent(name: string) {
  return apiRequest('DELETE', '/api/custom-agents', { query: { name } })
}

export async function exportCustomAgent(name: string, overwrite = false) {
  return apiPost('/api/custom-agents/export', { name, overwrite })
}

export async function generateAgentDraft(description: string) {
  return apiPost('/api/custom-agents/generate', { description })
}

export async function fetchAgentTemplates() {
  return apiGet('/api/agent-templates')
}

export async function fetchAgentTemplate(name: string) {
  return apiGet('/api/agent-templates', { name }, {
    errorMessage: (status) => `/api/agent-templates?name=${name} → ${status}`,
  })
}

export async function saveAgentTemplate(draft: unknown) {
  return apiPost('/api/agent-templates', { draft })
}

export async function importAgentTemplateUrl(url: string, name?: string) {
  return apiPost('/api/agent-templates', { url, name }, {
    errorMessage: (status) => `/api/agent-templates URL → ${status}`,
  })
}

export async function uploadAgentTemplate(file: File) {
  const fd = new FormData()
  fd.append('file', file)
  return apiRequest('POST', '/api/agent-templates', {
    rawBody: fd,
    skipJsonContentType: true,
    errorMessage: (status) => `/api/agent-templates upload → ${status}`,
  })
}

export async function deleteAgentTemplate(name: string) {
  return apiRequest('DELETE', '/api/agent-templates', { query: { name } })
}

export async function fetchWorkflowStepTemplates() {
  return apiGet('/api/workflow-step-templates')
}

export async function fetchWorkflowStepTemplate(name: string) {
  return apiGet('/api/workflow-step-templates', { name }, {
    errorMessage: (status) => `/api/workflow-step-templates?name=${name} → ${status}`,
  })
}

export async function saveWorkflowStepTemplate(template: unknown) {
  return apiPost('/api/workflow-step-templates', { template })
}

export async function deleteWorkflowStepTemplate(name: string) {
  return apiRequest('DELETE', '/api/workflow-step-templates', { query: { name } })
}

export interface BuildAndRunAgentInput {
  draft: unknown
  userPrompt: string
  workspace: string
  runnerId?: string
  projectId?: string
  metadata?: Record<string, unknown>
}

export interface BuildAndRunAgentResult {
  name: string
  job?: { id?: string; status?: string; logPath?: string; [key: string]: unknown }
}

export async function buildAndRunAgent(
  input: BuildAndRunAgentInput,
): Promise<BuildAndRunAgentResult> {
  const saved = await saveCustomAgent(input.draft, input.projectId)
  const name: string | undefined = saved?.name
  if (!name) throw new Error(i18n.global.t('common.errors.saveCustomAgent'))
  const res = await submitJob(
    {
      runnerId: input.runnerId,
      agentRef: `dashboard:${name}`,
      workspace: input.workspace,
      userPrompt: input.userPrompt,
      metadata: {
        ...(input.metadata ?? {}),
        ...(input.projectId ? { projectId: input.projectId } : {}),
      },
    },
    input.projectId,
  )
  return { name, job: res?.job }
}
