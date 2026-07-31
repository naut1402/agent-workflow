import { apiFetch } from '../../api/http'

/** Full catalog — QuickAction CRUD. Dashboard-global. */
export async function fetchArtifactActionsCatalog() {
  const r = await apiFetch('/api/artifact-actions')
  if (!r.ok) throw new Error(`/api/artifact-actions → ${r.status}`)
  return r.json()
}

export async function saveArtifactActionsCatalog(file: {
  version: number
  actions: unknown[]
  menus?: unknown[]
}) {
  const r = await apiFetch('/api/artifact-actions', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(file),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/artifact-actions PUT → ${r.status}`)
  return data
}
