import { apiFetch, qs } from '../../api/http'

export async function startNlChat(
  input: { entityType?: 'task' | 'pipeline' | 'agent'; message: string; runnerId?: string },
  projectId?: string,
) {
  const r = await apiFetch(`/api/nl-chat/sessions${qs({ project: projectId })}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/nl-chat/sessions POST → ${r.status}`)
  return data
}

export async function sendNlChatMessage(chatSessionId: string, message: string, projectId?: string) {
  const r = await apiFetch(
    `/api/nl-chat/sessions/${encodeURIComponent(chatSessionId)}/messages${qs({ project: projectId })}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    },
  )
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    throw new Error(data.error || `/api/nl-chat/sessions/${chatSessionId}/messages POST → ${r.status}`)
  }
  return data
}

export async function fetchNlChatTurn(chatSessionId: string, projectId?: string) {
  const r = await fetch(`/api/nl-chat/sessions/${encodeURIComponent(chatSessionId)}${qs({ project: projectId })}`)
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/nl-chat/sessions/${chatSessionId} → ${r.status}`)
  return data
}

export async function cancelNlChat(chatSessionId: string, projectId?: string) {
  const r = await apiFetch(
    `/api/nl-chat/sessions/${encodeURIComponent(chatSessionId)}/cancel${qs({ project: projectId })}`,
    { method: 'POST' },
  )
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error || `/api/nl-chat/sessions/${chatSessionId}/cancel POST → ${r.status}`)
  return data
}
