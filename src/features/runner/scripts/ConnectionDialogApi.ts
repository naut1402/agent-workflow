import { apiGet, apiPost } from '../../../api/http'

export async function fetchCredentials() {
  return apiGet('/api/credentials')
}

export async function saveCredential(profile: unknown) {
  return apiPost('/api/credentials', { profile })
}

export async function saveConnection(connection: unknown) {
  return apiPost('/api/connections', { connection })
}

export async function scanLocalCommands() {
  return apiGet('/api/connections/scan')
}
