// Thin fetch wrappers around the dev-server API exposed by server/devTeamApi.ts.

import type { TaskArchivePatch, TaskStatePatch } from '../../shared/schemas/task'
import { getApiToken } from '../shared/lib/authToken.js'
import { i18n } from '../shared/i18n'

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

// Auth-aware fetch: attaches the API token when one is configured, else falls
// back to a plain fetch (offline / no-token mode).
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
  const r = await fetch('/api/projects')
  if (!r.ok) throw new Error(`/api/projects → ${r.status}`)
  return r.json()
}

export async function fetchProject(id: string) {
  const r = await fetch(`/api/projects${qs({ id })}`)
  if (!r.ok) throw new Error(`/api/projects?id=${id} → ${r.status}`)
  return r.json()
}

export async function addProject(path: string, name?: string) {
  const r = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, name }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/projects POST → ${r.status}`)
  return data
}

export async function removeProject(id: string) {
  const r = await fetch(`/api/projects${qs({ id })}`, { method: 'DELETE' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/projects DELETE → ${r.status}`)
  return data
}

// ── Filesystem browse + autoscan ─────────────────────────────────────────────

export async function browseFs(dirPath?: string) {
  const r = await fetch(`/api/fs/browse${qs({ path: dirPath ?? '' })}`)
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/fs/browse → ${r.status}`)
  return data
}

export async function fetchAutoscanConfig() {
  const r = await fetch('/api/autoscan')
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/autoscan → ${r.status}`)
  return data
}

export async function saveAutoscanConfig(config: {
  enabled?: boolean
  whitelist?: string[]
  intervalMs?: number
}) {
  const r = await fetch('/api/autoscan', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/autoscan PUT → ${r.status}`)
  return data
}

export async function runAutoscan(whitelist?: string[]) {
  const r = await fetch('/api/autoscan/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(whitelist ? { whitelist } : {}),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/autoscan/run → ${r.status}`)
  return data
}

export async function fetchGithubTokensConfig() {
  const r = await fetch('/api/github/tokens')
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/github/tokens → ${r.status}`)
  return data
}

export async function saveGithubTokensConfig(config: {
  repos?: { repo: string; token: string }[]
}) {
  const r = await fetch('/api/github/tokens', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/github/tokens PUT → ${r.status}`)
  return data
}

// ── Task / artifact reads (project-scoped) ──────────────────────────────────────

export async function fetchTasks(projectId?: string) {
  const r = await fetch(`/api/tasks${qs({ project: projectId })}`)
  if (!r.ok) throw new Error(`/api/tasks → ${r.status}`)
  return r.json()
}

export async function patchTaskState(id: string, body: TaskStatePatch, projectId?: string) {
  const r = await apiFetch(`/api/task-state${qs({ id, project: projectId })}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const err = new Error(data.error || i18n.global.t('common.errors.updateTaskStatus', { status: r.status }))
    ;(err as any).status = r.status
    ;(err as any).data = data
    throw err
  }
  return data
}

export async function patchTaskArchive(id: string, body: TaskArchivePatch, projectId?: string) {
  const r = await apiFetch(`/api/task-archive${qs({ id, project: projectId })}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const err = new Error(data.error || i18n.global.t('common.errors.archiveTask', { status: r.status }))
    ;(err as any).status = r.status
    ;(err as any).data = data
    throw err
  }
  return data
}

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

export async function fetchCustomAgents() {
  const r = await fetch('/api/custom-agents')
  if (!r.ok) throw new Error(`/api/custom-agents → ${r.status}`)
  return r.json()
}

export async function fetchCustomAgent(name: string) {
  const r = await fetch(`/api/custom-agents?name=${encodeURIComponent(name)}`)
  if (!r.ok) throw new Error(`/api/custom-agents?name=${name} → ${r.status}`)
  return r.json()
}

export async function saveCustomAgent(draft: unknown, projectId?: string) {
  const r = await apiFetch(`/api/custom-agents${qs({ project: projectId })}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft }),
  })
  if (!r.ok) throw new Error(`/api/custom-agents POST → ${r.status}`)
  return r.json()
}

export async function deleteCustomAgent(name: string) {
  const r = await fetch(`/api/custom-agents?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`/api/custom-agents DELETE → ${r.status}`)
  return r.json()
}

export async function exportCustomAgent(name: string, overwrite = false) {
  const r = await fetch('/api/custom-agents/export', {
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
  const r = await fetch('/api/custom-agents/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  })
  if (!r.ok) throw new Error(`/api/custom-agents/generate → ${r.status}`)
  return r.json()
}

export async function fetchAgentTemplates() {
  const r = await fetch('/api/agent-templates')
  if (!r.ok) throw new Error(`/api/agent-templates → ${r.status}`)
  return r.json()
}

export async function fetchAgentTemplate(name: string) {
  const r = await fetch(`/api/agent-templates?name=${encodeURIComponent(name)}`)
  if (!r.ok) throw new Error(`/api/agent-templates?name=${name} → ${r.status}`)
  return r.json()
}

export async function saveAgentTemplate(draft: unknown) {
  const r = await fetch('/api/agent-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft }),
  })
  if (!r.ok) throw new Error(`/api/agent-templates POST → ${r.status}`)
  return r.json()
}

export async function importAgentTemplateUrl(url: string, name?: string) {
  const r = await fetch('/api/agent-templates', {
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
  const r = await fetch('/api/agent-templates', { method: 'POST', body: fd })
  if (!r.ok) throw new Error(`/api/agent-templates upload → ${r.status}`)
  return r.json()
}

export async function deleteAgentTemplate(name: string) {
  const r = await fetch(`/api/agent-templates?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`/api/agent-templates DELETE → ${r.status}`)
  return r.json()
}

export async function fetchWorkflowStepTemplates() {
  const r = await fetch('/api/workflow-step-templates')
  if (!r.ok) throw new Error(`/api/workflow-step-templates → ${r.status}`)
  return r.json()
}

export async function fetchWorkflowStepTemplate(name: string) {
  const r = await fetch(`/api/workflow-step-templates?name=${encodeURIComponent(name)}`)
  if (!r.ok) throw new Error(`/api/workflow-step-templates?name=${name} → ${r.status}`)
  return r.json()
}

export async function saveWorkflowStepTemplate(template: unknown) {
  const r = await fetch('/api/workflow-step-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template }),
  })
  if (!r.ok) throw new Error(`/api/workflow-step-templates POST → ${r.status}`)
  return r.json()
}

export async function deleteWorkflowStepTemplate(name: string) {
  const r = await fetch(`/api/workflow-step-templates?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`/api/workflow-step-templates DELETE → ${r.status}`)
  return r.json()
}

// ── Knowledge (file-based store) ─────────────────────────────────────────────

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

// ── Runners & jobs (global) ───────────────────────────────────────────────────

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

// ── Approval flow (require_approval quick actions) ───────────────────────────
// A job that settled at `awaiting_approval` ran against a scratch copy; nothing
// is on disk for real until `approveJob`. See server/runners/jobQueue.ts.

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

// ── Logs (global request/audit log + job execution log) ─────────────────────

export async function fetchLogs(
  { type, project, limit }: { type?: string; project?: string; limit?: number } = {},
) {
  const r = await fetch(`/api/logs${qs({ type, project, limit })}`)
  if (!r.ok) throw new Error(`/api/logs → ${r.status}`)
  return r.json()
}

export interface FetchJobLogOptions {
  /** Byte cursor the client already consumed. */
  offset?: number
  /** Long-poll wait hint (ms) for delta log endpoint. */
  wait?: number
}

export async function fetchJobLog(id: string, opts: FetchJobLogOptions = {}) {
  const r = await fetch(
    `/api/jobs/${encodeURIComponent(id)}/log${qs({ offset: opts.offset, wait: opts.wait })}`,
  )
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/jobs/${id}/log → ${r.status}`)
  return data
}

// ── Create task (dashboard scaffold) ─────────────────────────────────────────

export async function createTask(payload: unknown, projectId?: string) {
  const r = await apiFetch(`/api/tasks${qs({ project: projectId })}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/tasks POST → ${r.status}`)
  return data
}

// ── NL chat surface (F0012) ──────────────────────────────────────────────────
// Draft generation goes through the real agent runner CLI (submitJob/
// sendTaskFeedback), not a direct LLM API call — see design.md F0012 §2.

export async function startNlChat(
  input: { entityType?: 'task' | 'pipeline' | 'agent'; message: string; runnerId?: string },
  projectId?: string,
) {
  const r = await apiFetch(`/api/nl-chat/sessions${qs({ project: projectId })}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/nl-chat/sessions POST → ${r.status}`)
  return data
}

export async function sendNlChatMessage(chatSessionId: string, message: string, projectId?: string) {
  const r = await apiFetch(
    `/api/nl-chat/sessions/${encodeURIComponent(chatSessionId)}/messages${qs({ project: projectId })}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    },
  )
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    throw new Error(data.error || `/api/nl-chat/sessions/${chatSessionId}/messages POST → ${r.status}`)
  }
  return data
}

export async function fetchNlChatTurn(chatSessionId: string, projectId?: string) {
  const r = await fetch(`/api/nl-chat/sessions/${encodeURIComponent(chatSessionId)}${qs({ project: projectId })}`)
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/nl-chat/sessions/${chatSessionId} → ${r.status}`)
  return data
}

export async function cancelNlChat(chatSessionId: string, projectId?: string) {
  const r = await apiFetch(
    `/api/nl-chat/sessions/${encodeURIComponent(chatSessionId)}/cancel${qs({ project: projectId })}`,
    { method: 'POST' },
  )
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/nl-chat/sessions/${chatSessionId}/cancel POST → ${r.status}`)
  return data
}

export async function fetchGithubIssue(url: string, projectId?: string) {
  const r = await apiFetch(`/api/github/issue${qs({ project: projectId })}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/github/issue POST → ${r.status}`)
  return data
}

// ── Composed helpers ─────────────────────────────────────────────────────────

export interface BuildAndRunAgentInput {
  // AgentDraft to persist (name, description, skills, sections, …).
  draft: unknown
  // Smoke prompt sent to the runner to validate the freshly-built agent.
  userPrompt: string
  // Job workspace: task dir (`tasks/<id>`) when opened from a task, else sandbox.
  workspace: string
  runnerId?: string
  projectId?: string
  metadata?: Record<string, unknown>
}

export interface BuildAndRunAgentResult {
  name: string
  job?: { id?: string; status?: string; logPath?: string; [key: string]: unknown }
}

// Persist a custom agent then submit a smoke job that runs it via `dashboard:<name>`.
// Composes the existing `saveCustomAgent` + `submitJob` so the wizard has one
// call, and so the compose logic is unit-testable without rendering.
export async function buildAndRunAgent(
  input: BuildAndRunAgentInput,
): Promise<BuildAndRunAgentResult> {
  const saved = await saveCustomAgent(input.draft, input.projectId)
  const name: string | undefined = saved?.name
  if (!name) throw new Error(i18n.global.t('common.errors.saveCustomAgent'))
  const res = await submitJob(
    {
      runnerId: input.runnerId,
      agentRef: `dashboard:${name}`,
      workspace: input.workspace,
      userPrompt: input.userPrompt,
      metadata: {
        ...(input.metadata ?? {}),
        ...(input.projectId ? { projectId: input.projectId } : {}),
      },
    },
    input.projectId,
  )
  return { name, job: res?.job }
}
