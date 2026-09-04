import { apiGet, apiPost, apiRequest } from '../../../core/http/client'

/** Runners/jobs dùng chung nhiều feature. */
export async function fetchRunners() {
  return apiGet('/api/runners')
}

export async function submitJob(payload: unknown, projectId?: string) {
  return apiPost('/api/jobs', payload, { query: { project: projectId } })
}

export async function fetchJob(id: string) {
  return apiGet(`/api/jobs/${encodeURIComponent(id)}`)
}

/** Giữ `any[]` như suy luận cũ từ `apiGet` (T=any) — `unknown[]` làm `.find` trả `unknown` và vỡ PipelineView/Logs. */
export async function fetchJobs(limit?: number): Promise<{ jobs: any[] }>
export async function fetchJobs(opts: { limit?: number; status?: string }): Promise<{ jobs: any[] }>
export async function fetchJobs(arg?: number | { limit?: number; status?: string }): Promise<{ jobs: any[] }> {
  if (arg && typeof arg === 'object') {
    return apiGet('/api/jobs', { limit: arg.limit, status: arg.status })
  }
  return apiGet('/api/jobs', { limit: arg ?? 10 })
}

export async function fetchProposal(jobId: string) {
  return apiGet(`/api/jobs/${encodeURIComponent(jobId)}/proposal`) as Promise<{
    artifactName: string
    before: string
    after: string
  }>
}

export async function approveJob(jobId: string) {
  return apiPost(`/api/jobs/${encodeURIComponent(jobId)}/approve`)
}

export async function discardJob(jobId: string) {
  return apiPost(`/api/jobs/${encodeURIComponent(jobId)}/discard`)
}

export async function sendActionFeedback(jobId: string, feedback: string) {
  return apiPost(`/api/jobs/${encodeURIComponent(jobId)}/feedback`, { feedback })
}

export async function cancelJob(jobId: string) {
  return apiPost(`/api/jobs/${encodeURIComponent(jobId)}/cancel`)
}
