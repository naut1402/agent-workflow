// Knowledge entry CRUD (file-based store) + tags + file upload.

import { qs } from '../http'

export async function fetchKnowledgeList(
  { scope, tags, q, projectId }: { scope?: string; tags?: string[]; q?: string; projectId?: string } = {},
) {
  const r = await fetch(`/api/knowledge${qs({ scope, tags: tags?.join(','), q, project: projectId })}`)
  if (!r.ok) throw new Error(`/api/knowledge → ${r.status}`)
  return r.json()
}

export async function fetchKnowledgeEntry(id: string, projectId?: string) {
  const r = await fetch(`/api/knowledge${qs({ id, project: projectId })}`)
  if (!r.ok) throw new Error(`/api/knowledge?id=${id} → ${r.status}`)
  return r.json()
}

export async function createKnowledgeEntry(payload: unknown, projectId?: string) {
  const r = await fetch(`/api/knowledge${qs({ project: projectId })}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/knowledge POST → ${r.status}`)
  return data
}

export async function saveKnowledgeEntry(id: string, payload: unknown, projectId?: string) {
  const r = await fetch(`/api/knowledge${qs({ id, project: projectId })}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/knowledge PUT → ${r.status}`)
  return data
}

export async function deleteKnowledgeEntry(id: string, projectId?: string) {
  const r = await fetch(`/api/knowledge${qs({ id, project: projectId })}`, { method: 'DELETE' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/knowledge DELETE → ${r.status}`)
  return data
}

export async function fetchKnowledgeTags(projectId?: string) {
  const r = await fetch(`/api/knowledge/tags${qs({ project: projectId })}`)
  if (!r.ok) throw new Error(`/api/knowledge/tags → ${r.status}`)
  return r.json()
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
  const r = await fetch(`/api/knowledge/upload${qs({ project: projectId })}`, {
    method: 'POST',
    body: fd,
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/knowledge/upload → ${r.status}`)
  return data
}
