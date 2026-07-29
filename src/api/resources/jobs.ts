// Job submission + polling + approval flow (require_approval quick actions).
// A job that settled at `awaiting_approval` ran against a scratch copy; nothing
// is on disk for real until `approveJob`. See server/runners/jobQueue.ts.

import { apiFetch, qs } from '../http'

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

// Proposed diff for an awaiting-approval job: { artifactName, before, after }.
export async function fetchProposal(jobId: string) {
  const r = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/proposal`)
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/jobs/${jobId}/proposal → ${r.status}`)
  return data as { artifactName: string; before: string; after: string }
}

// Apply the scratch content to the real artifact.
export async function approveJob(jobId: string) {
  const r = await apiFetch(`/api/jobs/${encodeURIComponent(jobId)}/approve`, { method: 'POST' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/jobs/${jobId}/approve → ${r.status}`)
  return data
}

// Throw the scratch copy away — nothing is written to the real artifact.
export async function discardJob(jobId: string) {
  const r = await apiFetch(`/api/jobs/${encodeURIComponent(jobId)}/discard`, { method: 'POST' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/jobs/${jobId}/discard → ${r.status}`)
  return data
}

// Send follow-up feedback into the same CLI session; returns the new (queued)
// job that will itself reach `awaiting_approval`.
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
