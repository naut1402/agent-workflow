import { apiGet, apiPost, apiRequest } from '../../../api/http'

export async function fetchAgentTemplates() {
  return apiGet('/api/agent-templates')
}

export async function fetchAgentTemplate(name: string) {
  return apiGet('/api/agent-templates', { name }, {
    errorMessage: (status) => `/api/agent-templates?name=${name} → ${status}`,
  })
}

export async function importAgentTemplateUrl(url: string, name?: string) {
  return apiPost('/api/agent-templates', { url, name }, {
    errorMessage: (status) => `/api/agent-templates URL → ${status}`,
  })
}

export async function uploadAgentTemplate(file: File) {
  const fd = new FormData()
  fd.append('file', file)
  return apiRequest('POST', '/api/agent-templates', {
    rawBody: fd,
    skipJsonContentType: true,
    errorMessage: (status) => `/api/agent-templates upload → ${status}`,
  })
}

export async function deleteAgentTemplate(name: string) {
  return apiRequest('DELETE', '/api/agent-templates', { query: { name } })
}
