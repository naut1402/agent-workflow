import { apiGet, apiPost, apiRequest } from '../../../core/http/client'
import type { ProviderConfigOption } from '../types'

export async function fetchProviderConfigs() {
  return apiGet('/api/provider-configs')
}

export async function saveProviderConfig(providerConfig: ProviderConfigOption) {
  return apiPost('/api/provider-configs', { providerConfig })
}

export async function deleteProviderConfig(id: string) {
  return apiRequest('DELETE', '/api/provider-configs', { query: { id } })
}
