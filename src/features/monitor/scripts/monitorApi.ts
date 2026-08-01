import type { TaskArchivePatch } from '../schemas/task'
import { t } from '../../../plugins/i18n'
import { apiGet, apiPost, apiRequest } from '../../../core/http/client'

export async function fetchTasks(projectId?: string) {
  return apiGet('/api/tasks', { project: projectId })
}

export async function patchTaskArchive(id: string, body: TaskArchivePatch, projectId?: string) {
  return apiRequest('PUT', '/api/task-archive', {
    query: { id, project: projectId },
    body,
    errorMessage: (status) => t('common.errors.archiveTask', { status }),
  })
}

export async function deleteTask(id: string, projectId?: string) {
  return apiRequest('DELETE', `/api/tasks/${encodeURIComponent(id)}`, {
    query: { project: projectId },
    errorMessage: (status) => t('common.errors.deleteTask', { status }),
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

export async function fetchPipelineExport(id: string, projectId?: string) {
  return apiGet('/api/pipeline-export', { id, project: projectId })
}

export async function createTask(payload: unknown, projectId?: string) {
  return apiPost('/api/tasks', payload, { query: { project: projectId } })
}
