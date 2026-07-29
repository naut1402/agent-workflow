// Pipeline run/config/flow-profile CRUD (pipeline-editor domain).

import { apiFetch, qs } from '../http'

// Trigger the task's current step to run (clicking a node on the pipeline
// flow). `targetStepId` opts into server-side chaining across gate-less
// steps until it reaches that step, hits a HITL gate, or a job fails.
export async function runPipelineStep(
  id: string,
  body: { targetStepId?: string; runnerId?: string },
  projectId?: string,
) {
  const r = await apiFetch(`/api/tasks/${encodeURIComponent(id)}/run-step${qs({ project: projectId })}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const err = new Error(data.error || `/api/tasks/${id}/run-step → ${r.status}`)
    ;(err as any).status = r.status
    ;(err as any).data = data
    throw err
  }
  return data
}

export async function fetchPipelineExport(id: string, projectId?: string) {
  const r = await fetch(`/api/pipeline-export${qs({ id, project: projectId })}`)
  if (!r.ok) throw new Error(`/api/pipeline-export → ${r.status}`)
  return r.json()
}

export async function fetchPipelineConfig(id: string, projectId?: string) {
  const r = await fetch(`/api/pipeline-config${qs({ id, project: projectId })}`)
  if (!r.ok) throw new Error(`/api/pipeline-config → ${r.status}`)
  return r.json()
}

export async function fetchFlowProfile(id: string) {
  const r = await fetch(`/api/flow-profile?id=${encodeURIComponent(id)}`)
  if (!r.ok) throw new Error(`/api/flow-profile → ${r.status}`)
  return r.json()
}

export async function saveFlowProfile(id: string, profile: unknown) {
  const r = await fetch(`/api/flow-profile?id=${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  })
  if (!r.ok) throw new Error(`/api/flow-profile POST → ${r.status}`)
  return r.json()
}

export async function fetchPipelineProfiles(projectId?: string) {
  const r = await fetch(`/api/pipeline-profiles${qs({ project: projectId })}`)
  if (!r.ok) throw new Error(`/api/pipeline-profiles → ${r.status}`)
  return r.json()
}

export async function fetchPipelineProfile(name: string, projectId?: string) {
  const r = await fetch(`/api/pipeline-profiles${qs({ name, project: projectId })}`)
  if (!r.ok) throw new Error(`/api/pipeline-profiles?name=${name} → ${r.status}`)
  return r.json()
}

export async function savePipelineProfile(name: string, pipeline: unknown, projectId?: string) {
  const r = await fetch(`/api/pipeline-profiles${qs({ project: projectId })}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, pipeline }),
  })
  if (!r.ok) throw new Error(`/api/pipeline-profiles POST → ${r.status}`)
  return r.json()
}

export async function deletePipelineProfile(name: string, projectId?: string) {
  const r = await fetch(`/api/pipeline-profiles${qs({ name, project: projectId })}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`/api/pipeline-profiles DELETE → ${r.status}`)
  return r.json()
}

export async function writePipelineConfig(
  scope: string,
  pipeline: unknown,
  taskId?: string,
  projectId?: string,
) {
  const r = await fetch(`/api/pipeline-config-write${qs({ project: projectId })}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, pipeline, taskId }),
  })
  if (!r.ok) throw new Error(`/api/pipeline-config-write → ${r.status}`)
  return r.json()
}
