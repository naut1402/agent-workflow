import { apiGet, apiPost, apiRequest } from '../../../core/http/client'

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
