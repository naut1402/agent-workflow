import { apiGet, apiPost, apiRequest } from '../../../core/http/client'

export interface KnowledgeListParams {
  scope?: string
  tags?: string[]
  q?: string
  collection?: string
  /** `'tags'` trả kèm facet tag trong cùng response — tránh gọi thêm `/tags`. */
  include?: 'tags'
  projectId?: string
}

export async function fetchKnowledgeList(
  { scope, tags, q, collection, include, projectId }: KnowledgeListParams = {},
) {
  return apiGet('/api/knowledge', {
    scope,
    tags: tags?.join(','),
    q,
    collection,
    include,
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

// ── collection & tag admin ──────────────────────────────────────────────────

export interface CollectionPayload {
  name: string
  description?: string
  scope?: string
  tags?: string[]
  entryIds?: string[]
}

export async function fetchKnowledgeCollections(projectId?: string) {
  return apiGet('/api/knowledge/collections', { project: projectId })
}

export async function createKnowledgeCollection(payload: CollectionPayload, projectId?: string) {
  return apiPost('/api/knowledge/collections', payload, { query: { project: projectId } })
}

export async function saveKnowledgeCollection(id: string, payload: CollectionPayload, projectId?: string) {
  return apiRequest('PUT', `/api/knowledge/collections/${encodeURIComponent(id)}`, {
    query: { project: projectId },
    body: payload,
  })
}

/** Xoá nhóm, **không** xoá entry nào. */
export async function deleteKnowledgeCollection(id: string, projectId?: string) {
  return apiRequest('DELETE', `/api/knowledge/collections/${encodeURIComponent(id)}`, {
    query: { project: projectId },
  })
}

/** `to` bỏ trống = xoá tag khỏi mọi entry; `to` đã tồn tại = merge. */
export async function renameKnowledgeTag(from: string, to: string | undefined, projectId?: string) {
  return apiPost('/api/knowledge/tags/rename', { from, to }, { query: { project: projectId } })
}

/** Resolve id → nội dung + đường dẫn, cho khung chat chèn vào prompt. */
export async function fetchKnowledgeBundle(ids: string[], projectId?: string) {
  return apiGet('/api/knowledge/bundle', { ids: ids.join(','), project: projectId })
}
