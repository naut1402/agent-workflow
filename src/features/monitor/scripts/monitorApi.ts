import type { TaskArchivePatch, TaskNamePatch } from '../schemas/task'
import { t } from '../../../plugins/i18n'
import { apiGet, apiPost, apiRequest } from '../../../core/http/client'

export async function fetchProjects() {
  return apiGet('/api/projects')
}

export async function fetchProject(id: string) {
  return apiGet('/api/projects', { id }, {
    errorMessage: (status) => `/api/projects?id=${id} → ${status}`,
  })
}

export type AddProjectInput =
  | { path: string; name?: string; branch?: string }
  | { gitUrl: string; branch?: string; name?: string; destName?: string }

export async function addProject(input: AddProjectInput | string, name?: string) {
  if (typeof input === 'string') {
    return apiPost('/api/projects', { path: input, name })
  }
  return apiPost('/api/projects', input)
}

export async function removeProject(id: string) {
  return apiRequest('DELETE', '/api/projects', { query: { id } })
}

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

export async function patchTaskName(id: string, body: TaskNamePatch, projectId?: string) {
  return apiRequest('PUT', '/api/task-name', {
    query: { id, project: projectId },
    body,
    errorMessage: (status) => t('common.errors.renameTask', { status }),
  })
}

export async function deleteTask(id: string, projectId?: string) {
  return apiRequest('DELETE', `/api/tasks/${encodeURIComponent(id)}`, {
    query: { project: projectId },
    errorMessage: (status) => t('common.errors.deleteTask', { status }),
  })
}

export async function repairTaskState(id: string, projectId?: string) {
  return apiPost(`/api/tasks/${encodeURIComponent(id)}/repair-state`, {}, {
    query: { project: projectId },
    errorMessage: (status) => t('common.errors.repairTaskState', { status }),
  })
}

export async function closeTaskChatSession(id: string, projectId?: string, stepId?: string) {
  return apiPost(`/api/tasks/${encodeURIComponent(id)}/close-session`, {}, {
    query: { project: projectId, stepId },
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
  opts: { stepId?: string; mode?: 'queue' | 'immediate' } = {},
  projectId?: string,
) {
  return apiPost(
    `/api/tasks/${encodeURIComponent(id)}/feedback`,
    { feedback, stepId: opts.stepId, mode: opts.mode },
    { query: { project: projectId } },
  )
}

export async function fetchPipelineExport(id: string, projectId?: string) {
  return apiGet('/api/pipeline-export', { id, project: projectId })
}

export async function createTask(payload: unknown, projectId?: string) {
  return apiPost('/api/tasks', payload, { query: { project: projectId } })
}

export async function fetchTaskWorktree(id: string, projectId?: string) {
  return apiGet(`/api/tasks/${encodeURIComponent(id)}/worktree`, { project: projectId })
}

export async function cleanupTaskWorktree(id: string, projectId?: string) {
  return apiRequest('DELETE', `/api/tasks/${encodeURIComponent(id)}/worktree`, {
    query: { project: projectId },
    errorMessage: (status) => t('common.errors.cleanWorktree', { status }),
  })
}

/**
 * The server returns an error *code* (`worktree_dirty`, …), never a display
 * string — wording lives in i18n on this side. `apiRequest` attaches the
 * response body to `err.data`.
 */
export function describeWorktreeError(err: any): string {
  const data = err?.data ?? {}
  switch (data.error) {
    case 'worktree_dirty':
      return t('monitor.layout.worktreeErrDirty', {
        count: data.dirtyCount ?? 0,
        files: (data.dirtyFiles ?? []).join(', '),
      })
    case 'worktree_locked':
      return t('monitor.layout.worktreeErrLocked', { reason: data.lockReason || '—' })
    case 'worktree_not_found':
      return t('monitor.layout.worktreeErrNotFound')
    case 'worktree_ambiguous':
      return t('monitor.layout.worktreeAmbiguous')
    case 'worktree_outside_policy':
      return t('monitor.layout.worktreeErrOutside')
    case 'task_not_finished':
      return t('monitor.layout.worktreeErrNotFinished')
    case 'worktree_remove_failed':
    case 'git_failed':
      return t('monitor.layout.worktreeErrRemoveFailed', { detail: data.detail || '' })
    default:
      return String(err?.message || err)
  }
}
