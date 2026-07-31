import type { TaskArchivePatch, TaskStatePatch } from '../../core/contracts/schemas/task'
import { i18n } from '../../core/i18n'
import { apiFetch, qs } from '../../api/http'

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

export async function deleteTask(id: string, projectId?: string) {
  const r = await apiFetch(`/api/tasks/${encodeURIComponent(id)}${qs({ project: projectId })}`, {
    method: 'DELETE',
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const err = new Error(data.error || i18n.global.t('common.errors.deleteTask', { status: r.status }))
    ;(err as any).status = r.status
    ;(err as any).data = data
    throw err
  }
  return data
}

/** Chạy step hiện tại; `targetStepId` chain tới gate/fail. */
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

export async function fetchTaskChat(
  id: string,
  opts: { stepId?: string; from?: number } = {},
  projectId?: string,
) {
  const r = await fetch(
    `/api/tasks/${encodeURIComponent(id)}/chat${qs({
      project: projectId,
      stepId: opts.stepId,
      from: opts.from ? String(opts.from) : undefined,
    })}`,
  )
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/tasks/${id}/chat → ${r.status}`)
  return data
}

export async function sendTaskFeedback(
  id: string,
  feedback: string,
  opts: { stepId?: string } = {},
  projectId?: string,
) {
  const r = await apiFetch(`/api/tasks/${encodeURIComponent(id)}/feedback${qs({ project: projectId })}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback, stepId: opts.stepId }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const err = new Error(data.error || `/api/tasks/${id}/feedback → ${r.status}`)
    ;(err as any).status = r.status
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
  const r = await apiFetch(`/api/artifact-actions${qs({ artifact, project: projectId, attach })}`)
  if (!r.ok) throw new Error(`/api/artifact-actions → ${r.status}`)
  return r.json()
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
