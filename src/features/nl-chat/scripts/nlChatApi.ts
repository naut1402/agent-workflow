import { apiGet, apiPost } from '../../../core/http/client'
import type { NlChatEntityType } from '../schemas/nlChat'

export async function startNlChat(
  input: { entityType?: NlChatEntityType; message: string; runnerId?: string },
  projectId?: string,
) {
  return apiPost('/api/nl-chat/sessions', input, { query: { project: projectId } })
}

export async function sendNlChatMessage(chatSessionId: string, message: string, projectId?: string) {
  return apiPost(
    `/api/nl-chat/sessions/${encodeURIComponent(chatSessionId)}/messages`,
    { message },
    { query: { project: projectId } },
  )
}

export async function fetchNlChatTurn(chatSessionId: string, projectId?: string) {
  return apiGet(`/api/nl-chat/sessions/${encodeURIComponent(chatSessionId)}`, {
    project: projectId,
  })
}

export async function cancelNlChat(chatSessionId: string, projectId?: string) {
  return apiPost(
    `/api/nl-chat/sessions/${encodeURIComponent(chatSessionId)}/cancel`,
    undefined,
    { query: { project: projectId } },
  )
}
