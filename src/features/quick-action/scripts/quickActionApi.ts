import { apiGet, apiRequest } from '../../../api/http'

export async function fetchArtifactActionsCatalog() {
  return apiGet('/api/artifact-actions')
}

export async function saveArtifactActionsCatalog(file: {
  version: number
  actions: unknown[]
  menus?: unknown[]
}) {
  return apiRequest('PUT', '/api/artifact-actions', { body: file })
}
