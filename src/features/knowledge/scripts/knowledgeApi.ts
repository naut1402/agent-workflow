import { apiGet, apiPost, apiRequest } from '../../../core/http/client'

export async function fetchKnowledgeList(
  { scope, tags, q, projectId }: { scope?: string; tags?: string[]; q?: string; projectId?: string } = {},
) {
  return apiGet('/api/knowledge', {
    scope,
    tags: tags?.join(','),
    q,
    project: projectId,
  })
}

export async function fetchKnowledgeEntry(id: string, projectId?: string) {
  return apiGet('/api/knowledge', { id, project: projectId }, {
    errorMessage: (status) => `/api/knowledge?id=${id} → ${status}`,
  })
}

export async function createKnowledgeEntry(payload: unknown, projectId?: string) {
  return apiPost('/api/knowledge', payload, { query: { project: projectId } })
}

export async function saveKnowledgeEntry(id: string, payload: unknown, projectId?: string) {
  return apiRequest('PUT', '/api/knowledge', {
    query: { id, project: projectId },
    body: payload,
  })
}

export async function deleteKnowledgeEntry(id: string, projectId?: string) {
  return apiRequest('DELETE', '/api/knowledge', { query: { id, project: projectId } })
}

export async function fetchKnowledgeTags(projectId?: string) {
  return apiGet('/api/knowledge/tags', { project: projectId })
}

export async function uploadKnowledgeFile(
  file: File,
  { scope = 'project', tags = [], title, projectId }: { scope?: string; tags?: string[]; title?: string; projectId?: string } = {},
) {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('scope', scope)
  if (tags.length) fd.append('tags', tags.join(','))
  if (title) fd.append('title', title)
  return apiRequest('POST', '/api/knowledge/upload', {
    query: { project: projectId },
    rawBody: fd,
    skipJsonContentType: true,
  })
}
