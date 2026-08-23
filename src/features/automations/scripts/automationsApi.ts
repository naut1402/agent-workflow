/**
 * FE API client cho automations (#233) — mọi call gắn `?project=` theo
 * pattern monitorApi.
 */

import { apiGet, apiPost, apiRequest } from '../../../core/http/client.js'
import type {
  AutomationAction,
  AutomationRuleRecord,
  AutomationRun,
  AutomationRunOutcome,
  AutomationStepResult,
  CreateAutomationRequest,
  HttpRequestAction,
  RunCommandAction,
  RunTaskAction,
  RuleRuntimeState,
  TimerRepeat,
  UpdateAutomationRequest,
} from '../schemas/automation'

/** Rule + runtime state + next-run hiển thị trên UI (GET /api/automations). */
export interface AutomationListItem extends AutomationRuleRecord {
  state: {
    lastRunAt: string | null
    lastOutcome: AutomationRunOutcome | null
    triggerFired: Record<string, boolean>
    inFlight: boolean
  }
  nextRunAt: string | null
}

/** Options cho combobox trong form (GET /api/automations/form-options). */
export interface AutomationFormOptions {
  tasks: string[]
  profiles: string[]
  runners: Array<{ id: string; label: string; family?: string }>
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

export async function fetchAutomationFormOptions(projectId?: string) {
  return apiGet<AutomationFormOptions>('/api/automations/form-options', {
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

/** Run now (manual) — trả run đang `running`; kết quả cuối qua history poll. */
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

/** Lịch sử thực thi toàn project (mọi rule) — tab "Lịch sử thực thi". */
export async function fetchAllAutomationRuns(projectId?: string, limit = 50) {
  return apiGet<{ runs: AutomationRun[] }>('/api/automations/runs', {
    project: projectId,
    limit: String(limit),
  })
}

export type {
  AutomationAction,
  AutomationRuleRecord,
  AutomationRun,
  AutomationRunOutcome,
  AutomationStepResult,
  HttpRequestAction,
  RunCommandAction,
  RunTaskAction,
  RuleRuntimeState,
  TimerRepeat,
  CreateAutomationRequest,
  UpdateAutomationRequest,
}
