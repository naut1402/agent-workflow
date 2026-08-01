import { apiGet, apiPost, apiRequest } from '../../api/http'

export async function fetchRunners() {
  return apiGet('/api/runners')
}

export async function saveRunner(runner: unknown) {
  return apiPost('/api/runners', { runner })
}

export async function deleteRunner(id: string) {
  return apiRequest('DELETE', '/api/runners', { query: { id } })
}

export async function setDefaultRunner(id: string) {
  return apiPost('/api/runners/default', { id })
}

export async function fetchCredentials() {
  return apiGet('/api/credentials')
}

export async function saveCredential(profile: unknown) {
  return apiPost('/api/credentials', { profile })
}

export async function fetchConnections() {
  return apiGet('/api/connections')
}

export async function saveConnection(connection: unknown) {
  return apiPost('/api/connections', { connection })
}

export async function deleteConnection(id: string) {
  return apiRequest('DELETE', '/api/connections', { query: { id } })
}

export async function scanLocalCommands() {
  return apiGet('/api/connections/scan')
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
