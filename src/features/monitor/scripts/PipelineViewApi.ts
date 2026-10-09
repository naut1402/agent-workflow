import type { TaskStatePatch } from '../schemas/task'
import { t } from '../../../frontend/plugins/i18n'
import { apiGet, apiPost, apiRequest } from '../../../frontend/http/client'

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
  body: { stepId: string; resetScope: 'step' | 'onward'; deleteScope: 'none' | 'step' | 'onward' },
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

/** Stop node điều phối: bật cờ halt, trả quyền start về chế độ tay. */
export async function stopOrchestrator(id: string, mtime: number, projectId?: string) {
  return apiRequest('PUT', '/api/task-orchestrator', {
    query: { id, project: projectId },
    body: { halted: true, mtime },
    errorMessage: (status) => t('common.errors.updateTaskStatus', { status }),
  })
}

/** Run node điều phối: xoá cờ halt và giao một lượt cho agent. */
export async function startOrchestrator(id: string, mtime: number, projectId?: string) {
  return apiRequest('PUT', '/api/task-orchestrator', {
    query: { id, project: projectId },
    body: { halted: false, mtime },
    errorMessage: (status) => t('common.errors.updateTaskStatus', { status }),
  })
}
