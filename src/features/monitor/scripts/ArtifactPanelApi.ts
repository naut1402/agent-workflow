import { apiGet, apiPost, apiRequest } from '../../../core/http/client'

export async function fetchArtifact(id: string, name: string, projectId?: string) {
  return apiGet('/api/artifact', { id, name, project: projectId }, {
    errorMessage: (status) => `/api/artifact ${name} → ${status}`,
  })
}

export async function saveArtifact(
  id: string,
  name: string,
  content: string,
  projectId?: string,
  mtime?: number,
) {
  return apiRequest('PUT', '/api/artifact', {
    query: { id, name, project: projectId },
    body: { content, mtime },
    attach: 'body',
  })
}

export async function fetchArtifactActions(artifact: string, projectId?: string, attach?: string) {
  return apiGet('/api/artifact-actions', { artifact, project: projectId, attach })
}

export async function runArtifactAction(
  body: {
    taskId: string
    actionId: string
    artifactName: string
    runnerId?: string
    selectedText?: string
    selectionStartLine?: number
    selectionEndLine?: number
  },
  projectId?: string,
) {
  return apiPost('/api/artifact-actions/run', body, { query: { project: projectId } })
}
