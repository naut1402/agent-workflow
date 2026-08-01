import { apiGet, apiPost, apiRequest } from '../../api/http'

export async function fetchPipelineConfig(id: string, projectId?: string) {
  return apiGet('/api/pipeline-config', { id, project: projectId })
}

export async function fetchCatalog() {
  return apiGet('/api/catalog')
}

export async function fetchCatalogAgent(id: string) {
  return apiGet('/api/catalog-agent', { id })
}

export async function fetchRules() {
  return apiGet('/api/rules')
}

export async function fetchPipelineProfiles(projectId?: string) {
  return apiGet('/api/pipeline-profiles', { project: projectId })
}

export async function fetchPipelineProfile(name: string, projectId?: string) {
  return apiGet('/api/pipeline-profiles', { name, project: projectId }, {
    errorMessage: (status) => `/api/pipeline-profiles?name=${name} → ${status}`,
  })
}

export async function savePipelineProfile(name: string, pipeline: unknown, projectId?: string) {
  return apiPost('/api/pipeline-profiles', { name, pipeline }, { query: { project: projectId } })
}

export async function deletePipelineProfile(name: string, projectId?: string) {
  return apiRequest('DELETE', '/api/pipeline-profiles', { query: { name, project: projectId } })
}

export async function writePipelineConfig(
  scope: string,
  pipeline: unknown,
  taskId?: string,
  projectId?: string,
) {
  return apiPost('/api/pipeline-config-write', { scope, pipeline, taskId }, {
    query: { project: projectId },
  })
}
