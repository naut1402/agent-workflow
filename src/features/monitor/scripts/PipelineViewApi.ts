import type { TaskStatePatch } from '../schemas/task'
import { t } from '../../../plugins/i18n'
import { apiGet, apiPost, apiRequest } from '../../../core/http/client'

export async function patchTaskState(id: string, body: TaskStatePatch, projectId?: string) {
  return apiRequest('PUT', '/api/task-state', {
    query: { id, project: projectId },
    body,
    errorMessage: (status) => t('common.errors.updateTaskStatus', { status }),
  })
}

export async function runPipelineStep(
  id: string,
  body: { targetStepId?: string; runnerId?: string; skipIntermediate?: boolean },
  projectId?: string,
) {
  return apiPost(`/api/tasks/${encodeURIComponent(id)}/run-step`, body, {
    query: { project: projectId },
  })
}

export async function resetPipelineStep(
  id: string,
  body: { stepId: string; cascade: boolean },
  projectId?: string,
) {
  return apiPost(`/api/tasks/${encodeURIComponent(id)}/reset-step`, body, {
    query: { project: projectId },
  })
}

export async function fetchFlowProfile(id: string) {
  return apiGet('/api/flow-profile', { id })
}

export async function saveFlowProfile(id: string, profile: unknown) {
  return apiPost('/api/flow-profile', profile, { query: { id } })
}
