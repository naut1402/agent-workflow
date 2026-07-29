// Custom agent CRUD, agent templates, workflow-step templates, NL agent build.

import { i18n } from '../../shared/i18n'
import { apiFetch, qs } from '../http'
import { submitJob } from './jobs'

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
