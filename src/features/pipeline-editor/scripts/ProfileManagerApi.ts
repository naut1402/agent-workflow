import { apiGet, apiGetText, apiPost, apiRequest } from '../../../frontend/http/client'

export async function fetchPipelineProfiles(projectId?: string) {
  return apiGet('/api/pipeline-profiles', { project: projectId })
}

export async function downloadPipelineProfile(name: string, projectId?: string) {
  return apiGetText('/api/pipeline-profiles', { name, download: 1, project: projectId })
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
