import { qs } from '../../api/http'

export async function fetchPipelineConfig(id: string, projectId?: string) {
  const r = await fetch(`/api/pipeline-config${qs({ id, project: projectId })}`)
  if (!r.ok) throw new Error(`/api/pipeline-config → ${r.status}`)
  return r.json()
}

export async function fetchCatalog() {
  const r = await fetch('/api/catalog')
  if (!r.ok) throw new Error(`/api/catalog → ${r.status}`)
  return r.json()
}

export async function fetchCatalogAgent(id: string) {
  const r = await fetch(`/api/catalog-agent?id=${encodeURIComponent(id)}`)
  if (!r.ok) throw new Error(`/api/catalog-agent → ${r.status}`)
  return r.json()
}

export async function fetchRules() {
  const r = await fetch('/api/rules')
  if (!r.ok) throw new Error(`/api/rules → ${r.status}`)
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
