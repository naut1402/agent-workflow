import { apiGet, apiPost, apiRequest } from '../../../core/http/client'

export async function fetchCredentials() {
  return apiGet('/api/credentials')
}

export async function saveCredential(profile: unknown) {
  return apiPost('/api/credentials', { profile })
}

export async function fetchOAuthCapabilities() {
  return apiGet('/api/credentials/oauth/capabilities')
}

export async function startOAuthConnect(providerId: string, label: string) {
  return apiPost('/api/credentials/oauth/start', { providerId, label })
}

export async function exchangeOAuthCode(state: string, input: string) {
  return apiPost('/api/credentials/oauth/exchange', { state, input })
}

export async function fetchOAuthStatus(state: string) {
  return apiGet('/api/credentials/oauth/status', { state })
}

export async function saveConnection(connection: unknown) {
  return apiPost('/api/connections', { connection })
}

export async function deleteConnection(id: string) {
  return apiRequest('DELETE', '/api/connections', { query: { id } })
}

export async function scanLocalCommands() {
  return apiGet('/api/connections/scan')
}

export async function fetchCustomCommands() {
  return apiGet('/api/commands')
}

export async function saveCustomCommand(command: unknown) {
  return apiPost('/api/commands', { command })
}

export async function deleteCustomCommand(id: string) {
  return apiRequest('DELETE', '/api/commands', { query: { id } })
}
