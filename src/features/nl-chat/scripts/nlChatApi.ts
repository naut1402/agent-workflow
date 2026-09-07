import { apiGet, apiPost, apiRequest } from '../../../core/http/client'
import type { NlChatEntityType, UploadedAttachment } from '../schemas/nlChat'

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

/**
 * Upload the composer's attachments. Multipart (not JSON) so binaries survive;
 * the response paths are what gets appended to the outgoing message.
 * `taskId` writes into that task's directory — the agent CLI's own cwd.
 */
export async function uploadChatAttachments(
  files: File[],
  opts: { projectId?: string; taskId?: string } = {},
): Promise<{ files: UploadedAttachment[] }> {
  const fd = new FormData()
  for (const f of files) fd.append('files', f)
  if (opts.taskId) fd.append('taskId', opts.taskId)
  return apiRequest('POST', '/api/nl-chat/attachments', {
    query: { project: opts.projectId },
    rawBody: fd,
    skipJsonContentType: true,
    errorMessage: (status) => `/api/nl-chat/attachments → ${status}`,
  })
}
