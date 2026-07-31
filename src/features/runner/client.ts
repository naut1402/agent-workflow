import { apiFetch, qs } from '../../api/http'

export async function fetchRunners() {
  const r = await fetch('/api/runners')
  if (!r.ok) throw new Error(`/api/runners → ${r.status}`)
  return r.json()
}

export async function saveRunner(runner: unknown) {
  const r = await fetch('/api/runners', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runner }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/runners POST → ${r.status}`)
  return data
}

export async function deleteRunner(id: string) {
  const r = await fetch(`/api/runners?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/runners DELETE → ${r.status}`)
  return data
}

export async function setDefaultRunner(id: string) {
  const r = await fetch('/api/runners/default', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/runners/default → ${r.status}`)
  return data
}

export async function fetchCredentials() {
  const r = await fetch('/api/credentials')
  if (!r.ok) throw new Error(`/api/credentials → ${r.status}`)
  return r.json()
}

export async function saveCredential(profile: unknown) {
  const r = await fetch('/api/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/credentials POST → ${r.status}`)
  return data
}

export async function fetchConnections() {
  const r = await fetch('/api/connections')
  if (!r.ok) throw new Error(`/api/connections → ${r.status}`)
  return r.json()
}

export async function saveConnection(connection: unknown) {
  const r = await fetch('/api/connections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connection }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/connections POST → ${r.status}`)
  return data
}

export async function deleteConnection(id: string) {
  const r = await fetch(`/api/connections?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/connections DELETE → ${r.status}`)
  return data
}

export async function scanLocalCommands() {
  const r = await fetch('/api/connections/scan')
  if (!r.ok) throw new Error(`/api/connections/scan → ${r.status}`)
  return r.json()
}

export async function submitJob(payload: unknown, projectId?: string) {
  const r = await apiFetch(`/api/jobs${qs({ project: projectId })}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/jobs POST → ${r.status}`)
  return data
}

export async function fetchJob(id: string) {
  const r = await fetch(`/api/jobs/${encodeURIComponent(id)}`)
  if (!r.ok) throw new Error(`/api/jobs/${id} → ${r.status}`)
  return r.json()
}

export async function fetchJobs(limit = 10) {
  const r = await fetch(`/api/jobs?limit=${limit}`)
  if (!r.ok) throw new Error(`/api/jobs → ${r.status}`)
  return r.json()
}

/** Proposed diff khi job `awaiting_approval`. */
export async function fetchProposal(jobId: string) {
  const r = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/proposal`)
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/jobs/${jobId}/proposal → ${r.status}`)
  return data as { artifactName: string; before: string; after: string }
}

export async function approveJob(jobId: string) {
  const r = await apiFetch(`/api/jobs/${encodeURIComponent(jobId)}/approve`, { method: 'POST' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/jobs/${jobId}/approve → ${r.status}`)
  return data
}

export async function discardJob(jobId: string) {
  const r = await apiFetch(`/api/jobs/${encodeURIComponent(jobId)}/discard`, { method: 'POST' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/jobs/${jobId}/discard → ${r.status}`)
  return data
}

export async function sendActionFeedback(jobId: string, feedback: string) {
  const r = await apiFetch(`/api/jobs/${encodeURIComponent(jobId)}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/jobs/${jobId}/feedback → ${r.status}`)
  return data
}
