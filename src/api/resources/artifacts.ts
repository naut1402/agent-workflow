// Artifact read/write + artifact-actions (quick actions) catalog + run.

import { apiFetch, qs } from '../http'

export async function fetchArtifact(id: string, name: string, projectId?: string) {
  const r = await fetch(`/api/artifact${qs({ id, name, project: projectId })}`)
  if (!r.ok) throw new Error(`/api/artifact ${name} → ${r.status}`)
  return r.json()
}

export async function saveArtifact(
  id: string,
  name: string,
  content: string,
  projectId?: string,
  mtime?: number,
) {
  const r = await fetch(`/api/artifact${qs({ id, name, project: projectId })}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, mtime }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const err = new Error(data.error || `/api/artifact PUT → ${r.status}`)
    ;(err as any).status = r.status
    ;(err as any).body = data
    throw err
  }
  return data
}

export async function fetchArtifactActions(artifact: string, projectId?: string, attach?: string) {
  // Catalog is dashboard-global; `project` is unused for GET but kept optional
  // for callers that still pass it (harmless qs).
  const r = await apiFetch(`/api/artifact-actions${qs({ artifact, project: projectId, attach })}`)
  if (!r.ok) throw new Error(`/api/artifact-actions → ${r.status}`)
  return r.json()
}

// Full catalog (all fields, no `artifact` filter) — used by the QuickAction
// CRUD panel to list/edit every action. Dashboard-global (no project qs).
export async function fetchArtifactActionsCatalog() {
  const r = await apiFetch('/api/artifact-actions')
  if (!r.ok) throw new Error(`/api/artifact-actions → ${r.status}`)
  return r.json()
}

// Full-catalog replace (create/edit/delete all funnel through one PUT).
// Includes nested `menus`. Dashboard-global under `~/.dev-team-dashboard/`.
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

export async function runArtifactAction(
  body: {
    taskId: string
    actionId: string
    artifactName: string
    runnerId?: string
    selectedText?: string
    selectionStartLine?: number
    selectionEndLine?: number
  },
  projectId?: string,
) {
  const r = await apiFetch(`/api/artifact-actions/run${qs({ project: projectId })}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/artifact-actions/run → ${r.status}`)
  return data
}
