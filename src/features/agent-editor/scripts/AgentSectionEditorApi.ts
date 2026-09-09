import { apiPost } from '../../../core/http/client'

export async function saveAgentTemplate(draft: unknown) {
  return apiPost('/api/agent-templates', { draft })
}
