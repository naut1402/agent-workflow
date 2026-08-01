import { t } from '../../../plugins/i18n'
import { apiGet, apiPost, apiRequest } from '../../../core/http/client'
import { submitJob } from '../../runner/scripts/runnerApi'

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
  if (!name) throw new Error(t('common.errors.saveCustomAgent'))
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
