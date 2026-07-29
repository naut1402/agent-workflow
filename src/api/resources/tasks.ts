// Task list + task-scoped state/archive/create + GitHub issue import.

import type { TaskArchivePatch, TaskStatePatch } from '../../../shared/schemas/task'
import { i18n } from '../../shared/i18n'
import { apiFetch, qs } from '../http'

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
