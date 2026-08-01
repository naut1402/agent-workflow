import { apiPost } from '../../../api/http'

export async function fetchGithubIssue(url: string, projectId?: string) {
  return apiPost('/api/github/issue', { url }, { query: { project: projectId } })
}

export { createTask } from './monitorApi'
