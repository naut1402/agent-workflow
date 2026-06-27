// Thin fetch wrappers around the dev-server API exposed by server/devTeamApi.js.

// Build a query string from key/value pairs, dropping null/undefined/empty and
// URL-encoding values. Used to append the optional `?project=<id>` selector.
function qs(params) {
  const parts = []
  for (const [k, v] of Object.entries(params || {})) {
    if (v === null || v === undefined || v === '') continue
    parts.push(`${k}=${encodeURIComponent(v)}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

// ── Project registry ───────────────────────────────────────────────────────────

export async function fetchProjects() {
  const r = await fetch('/api/projects')
  if (!r.ok) throw new Error(`/api/projects → ${r.status}`)
  return r.json()
}

export async function fetchProject(id) {
  const r = await fetch(`/api/projects${qs({ id })}`)
  if (!r.ok) throw new Error(`/api/projects?id=${id} → ${r.status}`)
  return r.json()
}

export async function addProject(path, name) {
  const r = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, name }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/projects POST → ${r.status}`)
  return data
}

export async function removeProject(id) {
  const r = await fetch(`/api/projects${qs({ id })}`, { method: 'DELETE' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/projects DELETE → ${r.status}`)
  return data
}

// ── Task / artifact reads (project-scoped) ──────────────────────────────────────

export async function fetchTasks(projectId) {
  const r = await fetch(`/api/tasks${qs({ project: projectId })}`)
  if (!r.ok) throw new Error(`/api/tasks → ${r.status}`)
  return r.json()
}

export async function fetchArtifact(id, name, projectId) {
  const r = await fetch(`/api/artifact${qs({ id, name, project: projectId })}`)
  if (!r.ok) throw new Error(`/api/artifact ${name} → ${r.status}`)
  return r.json()
}

export async function fetchPipelineExport(id, projectId) {
  const r = await fetch(`/api/pipeline-export${qs({ id, project: projectId })}`)
  if (!r.ok) throw new Error(`/api/pipeline-export → ${r.status}`)
  return r.json()
}

export async function fetchPipelineConfig(id, projectId) {
  const r = await fetch(`/api/pipeline-config${qs({ id, project: projectId })}`)
  if (!r.ok) throw new Error(`/api/pipeline-config → ${r.status}`)
  return r.json()
}

export async function fetchFlowProfile(id) {
  const r = await fetch(`/api/flow-profile?id=${encodeURIComponent(id)}`)
  if (!r.ok) throw new Error(`/api/flow-profile → ${r.status}`)
  return r.json()
}

export async function saveFlowProfile(id, profile) {
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

export async function fetchCatalogAgent(id) {
  const r = await fetch(`/api/catalog-agent?id=${encodeURIComponent(id)}`)
  if (!r.ok) throw new Error(`/api/catalog-agent → ${r.status}`)
  return r.json()
}

export async function fetchRules() {
  const r = await fetch('/api/rules')
  if (!r.ok) throw new Error(`/api/rules → ${r.status}`)
  return r.json()
}

export async function fetchPipelineProfiles() {
  const r = await fetch('/api/pipeline-profiles')
  if (!r.ok) throw new Error(`/api/pipeline-profiles → ${r.status}`)
  return r.json()
}

export async function fetchPipelineProfile(name) {
  const r = await fetch(`/api/pipeline-profiles?name=${encodeURIComponent(name)}`)
  if (!r.ok) throw new Error(`/api/pipeline-profiles?name=${name} → ${r.status}`)
  return r.json()
}

export async function savePipelineProfile(name, pipeline) {
  const r = await fetch('/api/pipeline-profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, pipeline }),
  })
  if (!r.ok) throw new Error(`/api/pipeline-profiles POST → ${r.status}`)
  return r.json()
}

export async function deletePipelineProfile(name) {
  const r = await fetch(`/api/pipeline-profiles?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`/api/pipeline-profiles DELETE → ${r.status}`)
  return r.json()
}

export async function writePipelineConfig(scope, pipeline, taskId) {
  const r = await fetch('/api/pipeline-config-write', {
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

export async function fetchCustomAgent(name) {
  const r = await fetch(`/api/custom-agents?name=${encodeURIComponent(name)}`)
  if (!r.ok) throw new Error(`/api/custom-agents?name=${name} → ${r.status}`)
  return r.json()
}

export async function saveCustomAgent(draft) {
  const r = await fetch('/api/custom-agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft }),
  })
  if (!r.ok) throw new Error(`/api/custom-agents POST → ${r.status}`)
  return r.json()
}

export async function deleteCustomAgent(name) {
  const r = await fetch(`/api/custom-agents?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`/api/custom-agents DELETE → ${r.status}`)
  return r.json()
}

export async function exportCustomAgent(name, overwrite = false) {
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

export async function generateAgentDraft(description) {
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

export async function fetchAgentTemplate(name) {
  const r = await fetch(`/api/agent-templates?name=${encodeURIComponent(name)}`)
  if (!r.ok) throw new Error(`/api/agent-templates?name=${name} → ${r.status}`)
  return r.json()
}

export async function saveAgentTemplate(draft) {
  const r = await fetch('/api/agent-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft }),
  })
  if (!r.ok) throw new Error(`/api/agent-templates POST → ${r.status}`)
  return r.json()
}

export async function importAgentTemplateUrl(url, name) {
  const r = await fetch('/api/agent-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, name }),
  })
  if (!r.ok) throw new Error(`/api/agent-templates URL → ${r.status}`)
  return r.json()
}

export async function uploadAgentTemplate(file) {
  const fd = new FormData()
  fd.append('file', file)
  const r = await fetch('/api/agent-templates', { method: 'POST', body: fd })
  if (!r.ok) throw new Error(`/api/agent-templates upload → ${r.status}`)
  return r.json()
}

export async function deleteAgentTemplate(name) {
  const r = await fetch(`/api/agent-templates?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`/api/agent-templates DELETE → ${r.status}`)
  return r.json()
}

export async function fetchWorkflowStepTemplates() {
  const r = await fetch('/api/workflow-step-templates')
  if (!r.ok) throw new Error(`/api/workflow-step-templates → ${r.status}`)
  return r.json()
}

export async function fetchWorkflowStepTemplate(name) {
  const r = await fetch(`/api/workflow-step-templates?name=${encodeURIComponent(name)}`)
  if (!r.ok) throw new Error(`/api/workflow-step-templates?name=${name} → ${r.status}`)
  return r.json()
}

export async function saveWorkflowStepTemplate(template) {
  const r = await fetch('/api/workflow-step-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template }),
  })
  if (!r.ok) throw new Error(`/api/workflow-step-templates POST → ${r.status}`)
  return r.json()
}

export async function deleteWorkflowStepTemplate(name) {
  const r = await fetch(`/api/workflow-step-templates?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`/api/workflow-step-templates DELETE → ${r.status}`)
  return r.json()
}

// ── Knowledge (file-based store) ─────────────────────────────────────────────

export async function fetchKnowledgeList({ scope, tags, q, projectId } = {}) {
  const r = await fetch(`/api/knowledge${qs({ scope, tags: tags?.join(','), q, project: projectId })}`)
  if (!r.ok) throw new Error(`/api/knowledge → ${r.status}`)
  return r.json()
}

export async function fetchKnowledgeEntry(id, projectId) {
  const r = await fetch(`/api/knowledge${qs({ id, project: projectId })}`)
  if (!r.ok) throw new Error(`/api/knowledge?id=${id} → ${r.status}`)
  return r.json()
}

export async function createKnowledgeEntry(payload, projectId) {
  const r = await fetch(`/api/knowledge${qs({ project: projectId })}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/knowledge POST → ${r.status}`)
  return data
}

export async function saveKnowledgeEntry(id, payload, projectId) {
  const r = await fetch(`/api/knowledge${qs({ id, project: projectId })}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/knowledge PUT → ${r.status}`)
  return data
}

export async function deleteKnowledgeEntry(id, projectId) {
  const r = await fetch(`/api/knowledge${qs({ id, project: projectId })}`, { method: 'DELETE' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/knowledge DELETE → ${r.status}`)
  return data
}

export async function fetchKnowledgeTags(projectId) {
  const r = await fetch(`/api/knowledge/tags${qs({ project: projectId })}`)
  if (!r.ok) throw new Error(`/api/knowledge/tags → ${r.status}`)
  return r.json()
}

export async function uploadKnowledgeFile(file, { scope = 'project', tags = [], title, projectId } = {}) {
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

export async function saveRunner(runner) {
  const r = await fetch('/api/runners', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runner }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/runners POST → ${r.status}`)
  return data
}

export async function deleteRunner(id) {
  const r = await fetch(`/api/runners?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/runners DELETE → ${r.status}`)
  return data
}

export async function setDefaultRunner(id) {
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

export async function submitJob(payload) {
  const r = await fetch('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/jobs POST → ${r.status}`)
  return data
}

export async function fetchJob(id) {
  const r = await fetch(`/api/jobs/${encodeURIComponent(id)}`)
  if (!r.ok) throw new Error(`/api/jobs/${id} → ${r.status}`)
  return r.json()
}

export async function fetchJobs(limit = 10) {
  const r = await fetch(`/api/jobs?limit=${limit}`)
  if (!r.ok) throw new Error(`/api/jobs → ${r.status}`)
  return r.json()
}

// Fallback pipeline shape used only when a task has no resolved config (e.g.
// fetch error). Normally phases come from the per-task pipeline config embedded
// in /api/tasks (see phasesFromPipeline). Order = left→right flow; `hitl` is the
// gate that follows the phase.
export const PHASES = [
  { key: 'investigator', label: 'Investigate', artifact: 'investigate.md', hitl: 'hitl-1' },
  { key: 'designer', label: 'Design', artifact: 'design.md', hitl: 'hitl-2' },
  { key: 'implementer', label: 'Implement', artifact: 'phpstan.md', hitl: null },
  { key: 'reviewer', label: 'Review', artifact: 'review.md', hitl: 'hitl-3' },
  { key: 'pr-creator', label: 'PR', artifact: 'pr-desc.md', hitl: null },
]

// Map a resolved pipeline config (steps[]) onto the UI phase shape. `artifact`
// is the first produced file (used to infer "done"); `hitl` is the gate id that
// follows the step, if any.
export function phasesFromPipeline(pipeline) {
  const steps = pipeline?.steps
  if (!Array.isArray(steps) || !steps.length) return PHASES
  return steps.map((s) => ({
    key: s.id,
    label: s.name || s.id,
    artifact: (s.produces && s.produces[0]) || null,
    hitl: s.hitl?.gate_id ?? null,
  }))
}

// Derive a display status for a phase from artifacts + live state. The
// orchestrator's own rule is "status is inferred from artifact existence, not
// encoded" — we mirror that here, then layer the live cursor on top.
export function phaseStatus(phase, task) {
  const artifactDone = task.artifacts?.[phase.artifact]?.exists
  const isWaiting = phase.hitl && task.hitl_pending === phase.hitl
  const isActive = task.current_phase === phase.key && !task.hitl_pending
  if (isWaiting) return 'waiting'
  if (isActive) return 'active'
  if (artifactDone) return 'done'
  return 'pending'
}
