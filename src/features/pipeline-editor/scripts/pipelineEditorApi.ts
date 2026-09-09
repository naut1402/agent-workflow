import { apiGet, apiPost, apiRequest } from '../../../core/http/client'

export async function fetchPipelineConfig(id: string, projectId?: string) {
  return apiGet('/api/pipeline-config', { id, project: projectId })
}

export async function fetchCatalog(projectId?: string) {
  return apiGet('/api/catalog', { project: projectId })
}

export async function fetchCatalogAgent(id: string) {
  return apiGet('/api/catalog-agent', { id })
}

export async function fetchRules(projectId?: string) {
  return apiGet('/api/rules', { project: projectId })
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
