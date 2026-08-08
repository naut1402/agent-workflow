import { apiGet, apiPost, apiRequest } from '../../../core/http/client'

export async function fetchProjects() {
  return apiGet('/api/projects')
}

export async function fetchProject(id: string) {
  return apiGet('/api/projects', { id }, {
    errorMessage: (status) => `/api/projects?id=${id} → ${status}`,
  })
}

export type AddProjectInput =
  | { path: string; name?: string; branch?: string }
  | { gitUrl: string; branch?: string; name?: string; destName?: string }

export async function addProject(input: AddProjectInput | string, name?: string) {
  // Back-compat: addProject(path, name?)
  if (typeof input === 'string') {
    return apiPost('/api/projects', { path: input, name })
  }
  return apiPost('/api/projects', input)
}

export async function removeProject(id: string) {
  return apiRequest('DELETE', '/api/projects', { query: { id } })
}

export async function browseFs(dirPath?: string) {
  return apiGet('/api/fs/browse', { path: dirPath ?? '' })
}
