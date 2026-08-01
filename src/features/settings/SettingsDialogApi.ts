import { apiGet, apiPost, apiRequest } from '../../api/http'

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

export async function fetchAutoscanConfig() {
  return apiGet('/api/autoscan')
}

export async function saveAutoscanConfig(config: {
  enabled?: boolean
  whitelist?: string[]
  intervalMs?: number
}) {
  return apiRequest('PUT', '/api/autoscan', { body: config })
}

export async function runAutoscan(whitelist?: string[]) {
  return apiPost('/api/autoscan/run', whitelist ? { whitelist } : {})
}

export async function fetchGithubTokensConfig() {
  return apiGet('/api/github/tokens')
}

export async function saveGithubTokensConfig(config: {
  repos?: { repo: string; token: string }[]
}) {
  return apiRequest('PUT', '/api/github/tokens', { body: config })
}
