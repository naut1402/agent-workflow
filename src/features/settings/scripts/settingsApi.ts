import { apiGet, apiPost, apiRequest } from '../../../core/http/client'

export async function fetchProjects() {
  return apiGet('/api/projects')
}

export async function fetchProject(id: string) {
  return apiGet('/api/projects', { id }, {
    errorMessage: (status) => `/api/projects?id=${id} → ${status}`,
  })
}

export async function addProject(path: string, name?: string) {
  return apiPost('/api/projects', { path, name })
}

export async function removeProject(id: string) {
  return apiRequest('DELETE', '/api/projects', { query: { id } })
}

export async function browseFs(dirPath?: string) {
  return apiGet('/api/fs/browse', { path: dirPath ?? '' })
}
