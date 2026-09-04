/**
 * Automation scheduler (#233) — tick định kỳ quét automation của mọi project
 * trong registry, đánh giá trigger thời gian (timer: once/interval/cron) và
 * chạy action do hệ thống bơm vào (`bindAutomationRunner`, pattern
 * recoverPoller: module này không kéo monitor/runner khi unit-test).
 *
 * Sống sót qua restart: rule config ở data root, runtime state ở
 * `registryHome()/automations/` — khi boot quét lại là tính tiếp due.
 */

import { loadRegistry } from '../../../core/registry.js'
import type { AutomationRuleRecord } from '../schemas/automation.js'
import { evaluateRuleTriggers } from './matcher.js'
import { clearStaleInFlight, getRuleState } from './runLedger.js'
import { listAutomations, syncTriggerRegistry } from './rules.js'

export interface AutomationRunnerInput {
  root: string
  projectId: string | null
  rule: AutomationRuleRecord
  source: 'manual' | 'schedule' | 'event'
  /** Trigger khớp (id trong rule.triggers) — truyền vào run để dựng context. */
  triggerId?: string
  /** Payload event gốc khi source=event. */
  event?: { type: string; payload: Record<string, unknown> }
}

export type AutomationRunnerFn = (input: AutomationRunnerInput) => Promise<unknown> | unknown

/** Default noop — business/index.ts bơm `runAutomation` thật khi nạp server. */
let boundRunner: AutomationRunnerFn = async () => undefined

export function bindAutomationRunner(fn: AutomationRunnerFn): void {
  boundRunner = fn
}

export function getBoundAutomationRunner(): AutomationRunnerFn {
  return boundRunner
}

export function automationPollIntervalMs(): number {
  const raw = Number(process.env.AUTOMATION_POLL_INTERVAL_MS || '')
  if (Number.isFinite(raw) && raw >= 5_000) return Math.floor(raw)
  return 30_000
}

interface ProjectLike {
  id: string
  path: string
}

/** Mọi project trong registry + fallback `default` từ DEV_TEAM_ROOT (dev mode). */
function activeProjects(): ProjectLike[] {
  const { projects } = loadRegistry()
  if (projects.length) return projects.map((p) => ({ id: p.id, path: p.path }))
  const envRoot = process.env.DEV_TEAM_ROOT
  if (envRoot && envRoot.trim()) return [{ id: 'default', path: envRoot.trim() }]
  return []
}

/** Rule có trigger thời gian (scheduler xử); event do subscriber xử. */
export function hasTimerTrigger(rule: AutomationRuleRecord): boolean {
  return rule.triggers.some((t) => t.kind === 'timer')
}

/** Rule due + project của nó — tách ra để test không cần interval thật. */
export function collectDueSchedules(
  now: Date,
): Array<{ project: ProjectLike; rule: AutomationRuleRecord; triggerId: string }> {
  const due: Array<{ project: ProjectLike; rule: AutomationRuleRecord; triggerId: string }> = []
  for (const project of activeProjects()) {
    for (const rule of listAutomations(project.path)) {
      if (!rule.enabled || !hasTimerTrigger(rule)) continue
      const state = getRuleState(project.id, rule.id)
      const evaluation = evaluateRuleTriggers(rule.triggers, state, now)
      if (evaluation.due) due.push({ project, rule, triggerId: evaluation.dueTriggerIds[0] })
    }
  }
  return due
}

/** Một tick: chạy mọi rule due (tuần tự — action submit job, không cần song song). */
export async function tickAutomationScheduler(now: Date = new Date()): Promise<number> {
  let triggered = 0
  for (const { project, rule, triggerId } of collectDueSchedules(now)) {
    try {
      await boundRunner({ root: project.path, projectId: project.id, rule, source: 'schedule', triggerId })
      triggered++
    } catch (err) {
      console.warn(`[automations] run failed for ${project.id}:${rule.id}:`, err)
    }
  }
  return triggered
}

let schedulerStarted = false
let schedulerTimer: ReturnType<typeof setInterval> | null = null

export function startAutomationScheduler(): void {
  if (schedulerStarted) return
  schedulerStarted = true

  // Startup sweep: xoá inFlight kẹt từ lần chạy trước + đồng bộ trigger registry.
  for (const project of activeProjects()) {
    try {
      clearStaleInFlight(project.id)
      syncTriggerRegistry(project.path, project.id)
    } catch {
      /* defensive — một project hỏng không chặn các project khác */
    }
  }

  void tickAutomationScheduler()
  schedulerTimer = setInterval(() => {
    void tickAutomationScheduler()
  }, automationPollIntervalMs())
}

/** Tests only — dừng interval + cho phép start lại. */
export function _resetAutomationSchedulerForTest(): void {
  if (schedulerTimer) clearInterval(schedulerTimer)
  schedulerTimer = null
  schedulerStarted = false
}
