import { apiGet, apiPost, apiRequest } from '../../../frontend/http/client'

export type AgentScope = 'project' | 'global'

/** Một dòng trong danh sách agent — đúng 5 trường `GET /api/custom-agents` trả về. */
export interface AgentMeta {
  name: string
  description?: string
  model?: string
  /** `false` khi agent không do dashboard tạo và tự khai `editable: false`. */
  editable?: boolean
  scope: AgentScope
}

export async function fetchCustomAgents(projectId?: string): Promise<{ agents: AgentMeta[] }> {
  return apiGet('/api/custom-agents', { project: projectId })
}

export async function fetchCustomAgent(name: string, projectId?: string, scope?: AgentScope) {
  return apiGet('/api/custom-agents', { name, project: projectId, scope }, {
    errorMessage: (status) => `/api/custom-agents?name=${name} → ${status}`,
  })
}

/**
 * `scope: 'global'` writes to `~/.claude/agents/` (machine-wide, resolved as
 * `user:<name>`) instead of the current project's `custom-agents/`
 * (`dashboard:<name>`) — no `project` query is sent for `global`, since the
 * write doesn't depend on which project is selected.
 */
export async function saveCustomAgent(draft: unknown, projectId?: string, scope: AgentScope = 'project') {
  return apiPost('/api/custom-agents', { draft, scope }, { query: scope === 'global' ? {} : { project: projectId } })
}

export async function deleteCustomAgent(name: string, projectId?: string, scope: AgentScope = 'project') {
  return apiRequest('DELETE', '/api/custom-agents', {
    query: { name, scope, ...(scope === 'global' ? {} : { project: projectId }) },
  })
}
