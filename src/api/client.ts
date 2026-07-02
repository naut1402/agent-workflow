// Thin fetch wrappers around the dev-server API exposed by server/devTeamApi.ts.

import { getApiToken } from '../shared/lib/authToken.js'

// Build a query string from key/value pairs, dropping null/undefined/empty and
// URL-encoding values. Used to append the optional `?project=<id>` selector.
export function qs(params: Record<string, any> | null | undefined): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params || {})) {
    if (v === null || v === undefined || v === '') continue
    parts.push(`${k}=${encodeURIComponent(v)}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = getApiToken()
  if (!token) return fetch(input, init)

  const headers = new Headers(init.headers || {})
  if (!headers.has('Authorization') && !headers.has('X-Dev-Team-Token')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(input, { ...init, headers })
}

// ── Project registry ───────────────────────────────────────────────────────────

export async function fetchProjects() {
  const r = await apiFetch('/api/projects')
  if (!r.ok) throw new Error(`/api/projects → ${r.status}`)
  return r.json()
}

export async function fetchProject(id: string) {
  const r = await apiFetch(`/api/projects${qs({ id })}`)
  if (!r.ok) throw new Error(`/api/projects?id=${id} → ${r.status}`)
  return r.json()
}

export async function addProject(path: string, name?: string) {
  const r = await apiFetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, name }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/projects POST → ${r.status}`)
  return data
}

export async function addGitProject(gitUrl: string, branch?: string, name?: string) {
  const r = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gitUrl, branch, name }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/projects POST → ${r.status}`)
  return data
}

export async function syncProject(id: string) {
  const r = await fetch(`/api/projects/${encodeURIComponent(id)}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/projects/${id}/sync → ${r.status}`)
  return data
}

export async function removeProject(id: string) {
  const r = await apiFetch(`/api/projects${qs({ id })}`, { method: 'DELETE' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/projects DELETE → ${r.status}`)
  return data
}

// ── Task / artifact reads (project-scoped) ──────────────────────────────────────

export async function fetchTasks(projectId?: string) {
  const r = await apiFetch(`/api/tasks${qs({ project: projectId })}`)
  if (!r.ok) throw new Error(`/api/tasks → ${r.status}`)
  return r.json()
}

export async function fetchArtifact(id: string, name: string, projectId?: string) {
  const r = await apiFetch(`/api/artifact${qs({ id, name, project: projectId })}`)
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
  const r = await apiFetch(`/api/artifact${qs({ id, name, project: projectId })}`, {
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

export async function fetchPipelineExport(id: string, projectId?: string) {
  const r = await apiFetch(`/api/pipeline-export${qs({ id, project: projectId })}`)
  if (!r.ok) throw new Error(`/api/pipeline-export → ${r.status}`)
  return r.json()
}

export async function fetchPipelineConfig(id: string, projectId?: string) {
  const r = await apiFetch(`/api/pipeline-config${qs({ id, project: projectId })}`)
  if (!r.ok) throw new Error(`/api/pipeline-config → ${r.status}`)
  return r.json()
}

export async function fetchFlowProfile(id: string) {
  const r = await apiFetch(`/api/flow-profile?id=${encodeURIComponent(id)}`)
  if (!r.ok) throw new Error(`/api/flow-profile → ${r.status}`)
  return r.json()
}

export async function saveFlowProfile(id: string, profile: unknown) {
  const r = await apiFetch(`/api/flow-profile?id=${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  })
  if (!r.ok) throw new Error(`/api/flow-profile POST → ${r.status}`)
  return r.json()
}

export async function fetchCatalog() {
  const r = await apiFetch('/api/catalog')
  if (!r.ok) throw new Error(`/api/catalog → ${r.status}`)
  return r.json()
}

export async function fetchCatalogAgent(id: string) {
  const r = await apiFetch(`/api/catalog-agent?id=${encodeURIComponent(id)}`)
  if (!r.ok) throw new Error(`/api/catalog-agent → ${r.status}`)
  return r.json()
}

export async function fetchRules() {
  const r = await apiFetch('/api/rules')
  if (!r.ok) throw new Error(`/api/rules → ${r.status}`)
  return r.json()
}

export async function fetchPipelineProfiles() {
  const r = await apiFetch('/api/pipeline-profiles')
  if (!r.ok) throw new Error(`/api/pipeline-profiles → ${r.status}`)
  return r.json()
}

export async function fetchPipelineProfile(name: string) {
  const r = await apiFetch(`/api/pipeline-profiles?name=${encodeURIComponent(name)}`)
  if (!r.ok) throw new Error(`/api/pipeline-profiles?name=${name} → ${r.status}`)
  return r.json()
}

export async function savePipelineProfile(name: string, pipeline: unknown) {
  const r = await apiFetch('/api/pipeline-profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, pipeline }),
  })
  if (!r.ok) throw new Error(`/api/pipeline-profiles POST → ${r.status}`)
  return r.json()
}

export async function deletePipelineProfile(name: string) {
  const r = await apiFetch(`/api/pipeline-profiles?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`/api/pipeline-profiles DELETE → ${r.status}`)
  return r.json()
}

export async function writePipelineConfig(scope: string, pipeline: unknown, taskId?: string) {
  const r = await apiFetch('/api/pipeline-config-write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, pipeline, taskId }),
  })
  if (!r.ok) throw new Error(`/api/pipeline-config-write → ${r.status}`)
  return r.json()
}

export async function fetchCustomAgents() {
  const r = await apiFetch('/api/custom-agents')
  if (!r.ok) throw new Error(`/api/custom-agents → ${r.status}`)
  return r.json()
}

export async function fetchCustomAgent(name: string) {
  const r = await apiFetch(`/api/custom-agents?name=${encodeURIComponent(name)}`)
  if (!r.ok) throw new Error(`/api/custom-agents?name=${name} → ${r.status}`)
  return r.json()
}

export async function saveCustomAgent(draft: unknown) {
  const r = await apiFetch('/api/custom-agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft }),
  })
  if (!r.ok) throw new Error(`/api/custom-agents POST → ${r.status}`)
  return r.json()
}

export async function deleteCustomAgent(name: string) {
  const r = await apiFetch(`/api/custom-agents?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`/api/custom-agents DELETE → ${r.status}`)
  return r.json()
}

export async function exportCustomAgent(name: string, overwrite = false) {
  const r = await apiFetch('/api/custom-agents/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, overwrite }),
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err.error || `/api/custom-agents/export → ${r.status}`)
  }
  return r.json()
}

export async function generateAgentDraft(description: string) {
  const r = await apiFetch('/api/custom-agents/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  })
  if (!r.ok) throw new Error(`/api/custom-agents/generate → ${r.status}`)
  return r.json()
}

export async function fetchAgentTemplates() {
  const r = await apiFetch('/api/agent-templates')
  if (!r.ok) throw new Error(`/api/agent-templates → ${r.status}`)
  return r.json()
}

export async function fetchAgentTemplate(name: string) {
  const r = await apiFetch(`/api/agent-templates?name=${encodeURIComponent(name)}`)
  if (!r.ok) throw new Error(`/api/agent-templates?name=${name} → ${r.status}`)
  return r.json()
}

export async function saveAgentTemplate(draft: unknown) {
  const r = await apiFetch('/api/agent-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft }),
  })
  if (!r.ok) throw new Error(`/api/agent-templates POST → ${r.status}`)
  return r.json()
}

export async function importAgentTemplateUrl(url: string, name?: string) {
  const r = await apiFetch('/api/agent-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, name }),
  })
  if (!r.ok) throw new Error(`/api/agent-templates URL → ${r.status}`)
  return r.json()
}

export async function uploadAgentTemplate(file: File) {
  const fd = new FormData()
  fd.append('file', file)
  const r = await apiFetch('/api/agent-templates', { method: 'POST', body: fd })
  if (!r.ok) throw new Error(`/api/agent-templates upload → ${r.status}`)
  return r.json()
}

export async function deleteAgentTemplate(name: string) {
  const r = await apiFetch(`/api/agent-templates?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`/api/agent-templates DELETE → ${r.status}`)
  return r.json()
}

export async function fetchWorkflowStepTemplates() {
  const r = await apiFetch('/api/workflow-step-templates')
  if (!r.ok) throw new Error(`/api/workflow-step-templates → ${r.status}`)
  return r.json()
}

export async function fetchWorkflowStepTemplate(name: string) {
  const r = await apiFetch(`/api/workflow-step-templates?name=${encodeURIComponent(name)}`)
  if (!r.ok) throw new Error(`/api/workflow-step-templates?name=${name} → ${r.status}`)
  return r.json()
}

export async function saveWorkflowStepTemplate(template: unknown) {
  const r = await apiFetch('/api/workflow-step-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template }),
  })
  if (!r.ok) throw new Error(`/api/workflow-step-templates POST → ${r.status}`)
  return r.json()
}

export async function deleteWorkflowStepTemplate(name: string) {
  const r = await apiFetch(`/api/workflow-step-templates?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`/api/workflow-step-templates DELETE → ${r.status}`)
  return r.json()
}

// ── Knowledge (file-based store) ─────────────────────────────────────────────

export async function fetchKnowledgeList(
  { scope, tags, q, projectId }: { scope?: string; tags?: string[]; q?: string; projectId?: string } = {},
) {
  const r = await apiFetch(`/api/knowledge${qs({ scope, tags: tags?.join(','), q, project: projectId })}`)
  if (!r.ok) throw new Error(`/api/knowledge → ${r.status}`)
  return r.json()
}

export async function fetchKnowledgeEntry(id: string, projectId?: string) {
  const r = await apiFetch(`/api/knowledge${qs({ id, project: projectId })}`)
  if (!r.ok) throw new Error(`/api/knowledge?id=${id} → ${r.status}`)
  return r.json()
}

export async function createKnowledgeEntry(payload: unknown, projectId?: string) {
  const r = await apiFetch(`/api/knowledge${qs({ project: projectId })}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/knowledge POST → ${r.status}`)
  return data
}

export async function saveKnowledgeEntry(id: string, payload: unknown, projectId?: string) {
  const r = await apiFetch(`/api/knowledge${qs({ id, project: projectId })}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/knowledge PUT → ${r.status}`)
  return data
}

export async function deleteKnowledgeEntry(id: string, projectId?: string) {
  const r = await apiFetch(`/api/knowledge${qs({ id, project: projectId })}`, { method: 'DELETE' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/knowledge DELETE → ${r.status}`)
  return data
}

export async function fetchKnowledgeTags(projectId?: string) {
  const r = await apiFetch(`/api/knowledge/tags${qs({ project: projectId })}`)
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
  const r = await apiFetch(`/api/knowledge/upload${qs({ project: projectId })}`, {
    method: 'POST',
    body: fd,
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/knowledge/upload → ${r.status}`)
  return data
}

// ── Runners & jobs (global) ───────────────────────────────────────────────────

export async function fetchRunners() {
  const r = await apiFetch('/api/runners')
  if (!r.ok) throw new Error(`/api/runners → ${r.status}`)
  return r.json()
}

export async function saveRunner(runner: unknown) {
  const r = await apiFetch('/api/runners', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runner }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/runners POST → ${r.status}`)
  return data
}

export async function deleteRunner(id: string) {
  const r = await apiFetch(`/api/runners?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/runners DELETE → ${r.status}`)
  return data
}

export async function setDefaultRunner(id: string) {
  const r = await apiFetch('/api/runners/default', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/runners/default → ${r.status}`)
  return data
}

export async function fetchCredentials() {
  const r = await apiFetch('/api/credentials')
  if (!r.ok) throw new Error(`/api/credentials → ${r.status}`)
  return r.json()
}

export async function submitJob(payload: unknown) {
  const r = await apiFetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/jobs POST → ${r.status}`)
  return data
}

export async function fetchJob(id: string) {
  const r = await apiFetch(`/api/jobs/${encodeURIComponent(id)}`)
  if (!r.ok) throw new Error(`/api/jobs/${id} → ${r.status}`)
  return r.json()
}

export async function fetchJobs(limit = 10) {
  const r = await apiFetch(`/api/jobs?limit=${limit}`)
  if (!r.ok) throw new Error(`/api/jobs → ${r.status}`)
  return r.json()
}

// ── Logs (global request/audit log + job execution log) ─────────────────────

export async function fetchLogs(
  { type, project, limit }: { type?: string; project?: string; limit?: number } = {},
) {
  const r = await apiFetch(`/api/logs${qs({ type, project, limit })}`)
  if (!r.ok) throw new Error(`/api/logs → ${r.status}`)
  return r.json()
}

export async function fetchJobLog(id: string) {
  const r = await apiFetch(`/api/jobs/${encodeURIComponent(id)}/log`)
  if (!r.ok) throw new Error(`/api/jobs/${id}/log → ${r.status}`)
  return r.json()
}
