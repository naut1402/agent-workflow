/**
 * FE API client cho automations (#233) — mọi call gắn `?project=` theo
 * pattern monitorApi.
 */

import { apiGet, apiPost, apiRequest } from '../../../core/http/client.js'
import type {
  AutomationRuleRecord,
  AutomationRun,
  AutomationRunOutcome,
  CreateAutomationRequest,
  RuleRuntimeState,
  UpdateAutomationRequest,
} from '../schemas/automation'

/** Rule + runtime state + next-run hiển thị trên UI (GET /api/automations). */
export interface AutomationListItem extends AutomationRuleRecord {
  state: {
    lastRunAt: string | null
    lastOutcome: AutomationRunOutcome | null
    fired: boolean
    inFlight: boolean
  }
  nextRunAt: string | null
}

export async function fetchAutomations(projectId?: string) {
  return apiGet<{ automations: AutomationListItem[] }>('/api/automations', {
    project: projectId,
  })
}

export async function fetchAutomationEventTypes(projectId?: string) {
  return apiGet<{ types: string[] }>('/api/automations/event-types', {
    project: projectId,
  })
}

export async function createAutomation(payload: CreateAutomationRequest, projectId?: string) {
  return apiPost<{ automation: AutomationRuleRecord }>('/api/automations', payload, {
    query: { project: projectId },
  })
}

export async function updateAutomation(
  id: string,
  payload: UpdateAutomationRequest,
  projectId?: string,
) {
  return apiRequest<{ automation: AutomationRuleRecord }>('PUT', `/api/automations/${encodeURIComponent(id)}`, {
    body: payload,
    query: { project: projectId },
  })
}

export async function toggleAutomation(id: string, enabled: boolean, projectId?: string) {
  return apiPost<{ automation: AutomationRuleRecord }>(
    `/api/automations/${encodeURIComponent(id)}/toggle`,
    { enabled },
    { query: { project: projectId } },
  )
}

export async function deleteAutomation(id: string, projectId?: string) {
  return apiRequest<{ id: string; deleted: boolean }>(
    'DELETE',
    `/api/automations/${encodeURIComponent(id)}`,
    { query: { project: projectId } },
  )
}

/** Run now (manual) — trả run record chứa outcome (succeeded/failed/skipped). */
export async function runAutomationNow(id: string, projectId?: string) {
  return apiPost<{ run: AutomationRun }>(
    `/api/automations/${encodeURIComponent(id)}/run`,
    {},
    { query: { project: projectId } },
  )
}

export async function fetchAutomationRuns(id: string, projectId?: string, limit = 20) {
  return apiGet<{ runs: AutomationRun[] }>(`/api/automations/${encodeURIComponent(id)}/runs`, {
    project: projectId,
    limit: String(limit),
  })
}

export type { AutomationRuleRecord, RuleRuntimeState, AutomationRun, AutomationRunOutcome }
