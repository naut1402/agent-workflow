import { apiGet, apiPost, apiRequest } from '../../../core/http/client'

export async function saveRunner(runner: unknown) {
  return apiPost('/api/runners', { runner })
}

export async function deleteRunner(id: string) {
  return apiRequest('DELETE', '/api/runners', { query: { id } })
}

export async function setDefaultRunner(id: string) {
  return apiPost('/api/runners/default', { id })
}

export async function fetchConnections() {
  return apiGet('/api/connections')
}
