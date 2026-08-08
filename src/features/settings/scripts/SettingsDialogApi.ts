import { apiGet, apiPost, apiRequest } from '../../../core/http/client'

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

export async function fetchLoggingConfig() {
  return apiGet('/api/logging-config')
}

export async function saveLoggingConfig(config: {
  showLogsTab?: boolean
  types?: { audit?: boolean; request?: boolean; jobs?: boolean; events?: boolean }
}) {
  return apiRequest('PUT', '/api/logging-config', { body: config })
}
