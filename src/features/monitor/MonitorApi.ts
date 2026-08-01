import type { TaskArchivePatch, TaskStatePatch } from '../../core/contracts/schemas/task'
import { i18n } from '../../core/i18n'
import { apiGet, apiPost, apiRequest } from '../../api/http'

export async function fetchTasks(projectId?: string) {
  return apiGet('/api/tasks', { project: projectId })
}

export async function patchTaskState(id: string, body: TaskStatePatch, projectId?: string) {
  return apiRequest('PUT', '/api/task-state', {
    query: { id, project: projectId },
    body,
    errorMessage: (status) => i18n.global.t('common.errors.updateTaskStatus', { status }),
  })
}

export async function patchTaskArchive(id: string, body: TaskArchivePatch, projectId?: string) {
  return apiRequest('PUT', '/api/task-archive', {
    query: { id, project: projectId },
    body,
    errorMessage: (status) => i18n.global.t('common.errors.archiveTask', { status }),
  })
}

export async function deleteTask(id: string, projectId?: string) {
  return apiRequest('DELETE', `/api/tasks/${encodeURIComponent(id)}`, {
    query: { project: projectId },
    errorMessage: (status) => i18n.global.t('common.errors.deleteTask', { status }),
  })
}

export async function runPipelineStep(
  id: string,
  body: { targetStepId?: string; runnerId?: string },
  projectId?: string,
) {
  return apiPost(`/api/tasks/${encodeURIComponent(id)}/run-step`, body, {
    query: { project: projectId },
  })
}

export async function fetchTaskChat(
  id: string,
  opts: { stepId?: string; from?: number } = {},
  projectId?: string,
) {
  return apiGet(`/api/tasks/${encodeURIComponent(id)}/chat`, {
    project: projectId,
    stepId: opts.stepId,
    from: opts.from ? String(opts.from) : undefined,
  })
}

export async function sendTaskFeedback(
  id: string,
  feedback: string,
  opts: { stepId?: string } = {},
  projectId?: string,
) {
  return apiPost(
    `/api/tasks/${encodeURIComponent(id)}/feedback`,
    { feedback, stepId: opts.stepId },
    { query: { project: projectId } },
  )
}

export async function fetchArtifact(id: string, name: string, projectId?: string) {
  return apiGet('/api/artifact', { id, name, project: projectId }, {
    errorMessage: (status) => `/api/artifact ${name} → ${status}`,
  })
}

export async function saveArtifact(
  id: string,
  name: string,
  content: string,
  projectId?: string,
  mtime?: number,
) {
  return apiRequest('PUT', '/api/artifact', {
    query: { id, name, project: projectId },
    body: { content, mtime },
    attach: 'body',
  })
}

export async function fetchArtifactActions(artifact: string, projectId?: string, attach?: string) {
  return apiGet('/api/artifact-actions', { artifact, project: projectId, attach })
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
  return apiPost('/api/artifact-actions/run', body, { query: { project: projectId } })
}

export async function fetchPipelineExport(id: string, projectId?: string) {
  return apiGet('/api/pipeline-export', { id, project: projectId })
}

export async function fetchFlowProfile(id: string) {
  return apiGet('/api/flow-profile', { id })
}

export async function saveFlowProfile(id: string, profile: unknown) {
  return apiPost('/api/flow-profile', profile, { query: { id } })
}

export async function createTask(payload: unknown, projectId?: string) {
  return apiPost('/api/tasks', payload, { query: { project: projectId } })
}

export async function fetchGithubIssue(url: string, projectId?: string) {
  return apiPost('/api/github/issue', { url }, { query: { project: projectId } })
}
