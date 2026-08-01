import { apiGet, apiPost, apiRequest } from '../../../core/http/client'

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
