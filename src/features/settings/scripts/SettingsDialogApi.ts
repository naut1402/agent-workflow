import { apiGet, apiPost, apiRequest } from '../../../api/http'

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
