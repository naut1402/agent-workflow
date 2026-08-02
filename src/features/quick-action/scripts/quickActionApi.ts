import { apiGet, apiRequest } from '../../../core/http/client'

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
