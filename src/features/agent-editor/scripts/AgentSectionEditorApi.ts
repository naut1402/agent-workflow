import { apiPost } from '../../../api/http'

export async function saveAgentTemplate(draft: unknown) {
  return apiPost('/api/agent-templates', { draft })
}
