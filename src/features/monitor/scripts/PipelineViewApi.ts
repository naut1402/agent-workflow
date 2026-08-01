import type { TaskStatePatch } from '../../../core/contracts/schemas/task'
import { i18n } from '../../../core/i18n'
import { apiGet, apiPost, apiRequest } from '../../../api/http'

export async function patchTaskState(id: string, body: TaskStatePatch, projectId?: string) {
  return apiRequest('PUT', '/api/task-state', {
    query: { id, project: projectId },
    body,
    errorMessage: (status) => i18n.global.t('common.errors.updateTaskStatus', { status }),
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

export async function fetchFlowProfile(id: string) {
  return apiGet('/api/flow-profile', { id })
}

export async function saveFlowProfile(id: string, profile: unknown) {
  return apiPost('/api/flow-profile', profile, { query: { id } })
}
