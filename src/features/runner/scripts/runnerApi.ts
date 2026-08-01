import { apiGet, apiPost, apiRequest } from '../../../api/http'

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

export async function fetchJobs(limit = 10) {
  return apiGet('/api/jobs', { limit })
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
