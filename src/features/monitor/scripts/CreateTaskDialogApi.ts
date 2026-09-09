import { apiGet, apiPost } from '../../../core/http/client'

export async function fetchGithubIssue(url: string, projectId?: string) {
  return apiPost('/api/github/issue', { url }, { query: { project: projectId } })
}

export async function fetchGithubTokenRepos(projectId?: string): Promise<string[]> {
  const data = await apiGet('/api/github/tokens', { project: projectId })
  return (data.config?.repos ?? []).map((r: { repo: string }) => r.repo)
}

export async function fetchOpenGithubIssues(repo: string, projectId?: string) {
  return apiGet('/api/github/issues', { repo, project: projectId })
}

export { createTask } from './monitorApi'
