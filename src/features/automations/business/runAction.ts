/**
 * Thực thi chuỗi action của automation rule. Action chạy tuần tự; mỗi bước
 * chờ job của nó kết thúc rồi capture stdout + artifacts làm biến
 * (`{{steps.N.stdout}}`, `{{steps.N.artifacts.<name>}}`) cho bước sau.
 *
 * Chuỗi chạy nền (fire-and-forget) để không chặn tick scheduler — `inFlight`
 * chặn event-trigger chạy chồng. Thất bại nằm trong run record, không ném lỗi lên caller.
 */

import { joinPath, randomUUID, readTextFileSync, readdirSync } from '../../../backend/lib/fileHelper.js'
import { emit } from '../../../backend/events/index.js'
import { loadJob } from './peers.js'
import type { JobRecord } from './peers.js'
import type {
  AutomationAction,
  AutomationRun,
  AutomationRunOutcome,
  AutomationStepResult,
} from '../schemas/automation.js'
import type { AutomationRunnerInput } from './AutomationRunner.js'
import { actionExecutorFor } from './actions/actionExecutors.js'
import { capText, STEP_STDOUT_CAP } from './actions/AutomationActionExecutor.js'
import { firedOnceTriggersAtRun } from './matcher.js'
import { disableIfAllOnceTriggersSpent, syncTriggerRegistry } from './rules.js'
import {
  getRuleState,
  saveRun,
  setRuleState,
} from './runLedger.js'
import { substituteVarsInRecord, type AutomationVarsContext, type TriggerContext } from '../lib/vars.js'

/** Timeout chờ mỗi bước job xong — mặc định 30 phút, override bằng env. */
export function stepTimeoutMs(): number {
  const raw = Number(process.env.AUTOMATION_STEP_TIMEOUT_MS || '')
  if (Number.isFinite(raw) && raw >= 30_000) return Math.floor(raw)
  return 30 * 60_000
}

const POLL_INTERVAL_MS = 1_500
const ARTIFACT_EACH_CAP = 32_000
const ARTIFACT_TOTAL_CAP = 128_000

/** stdout của job: ưu tiên `job.stdout` (persist cho agent-CLI), fallback log file. */
function stdoutOf(job: JobRecord): string {
  if (typeof job.stdout === 'string' && job.stdout.trim()) return capText(job.stdout, STEP_STDOUT_CAP)
  if (!job.logPath) return ''
  try {
    return capText(readTextFileSync(job.logPath), STEP_STDOUT_CAP)
  } catch {
    return ''
  }
}

/** Đọc artifacts `tasks/<id>/*.md` — key = tên file bỏ `.md`, cap kích thước. */
function artifactsOf(root: string, taskId: string): Record<string, string> {
  const dir = joinPath(root, 'tasks', taskId)
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'))
  } catch {
    return {}
  }
  const out: Record<string, string> = {}
  let total = 0
  for (const f of files) {
    if (total >= ARTIFACT_TOTAL_CAP) break
    try {
      const content = capText(readTextFileSync(joinPath(dir, f)), ARTIFACT_EACH_CAP)
      total += content.length
      out[f.replace(/\.md$/, '')] = content
    } catch {
      /* bỏ qua artifact đọc hỏng */
    }
  }
  return out
}

/** Poll job tới trạng thái terminal — trả job cuối hoặc null khi timeout/mất. */
export async function waitJobTerminal(jobId: string, timeoutMs: number): Promise<JobRecord | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const job = loadJob(jobId)
    if (!job) return null
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') return job
    if (Date.now() >= deadline) return job
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
}

function triggerContextOf(input: AutomationRunnerInput): TriggerContext {
  if (input.source === 'event' && input.event) {
    return { kind: 'event', type: input.event.type, payload: input.event.payload }
  }
  const timer = input.rule.triggers.find((t) => t.kind === 'timer')
  if (timer && timer.kind === 'timer') {
    return {
      kind: 'timer',
      type: timer.repeat.mode,
      payload: {
        startAt: timer.startAt,
        ...(timer.repeat.mode === 'interval' ? { everyMs: timer.repeat.everyMs } : {}),
        ...(timer.repeat.mode === 'cron' ? { expr: timer.repeat.expr } : {}),
      },
    }
  }
  return { kind: 'manual', payload: {} }
}

async function executeSequence(
  input: AutomationRunnerInput,
  run: AutomationRun,
  stateBase: { lastRunAt: string },
): Promise<void> {
  const ctx: AutomationVarsContext = { trigger: triggerContextOf(input), steps: [] }
  run.steps = []
  let outcome: AutomationRunOutcome = 'succeeded'
  let error: string | undefined

  try {
    for (let i = 0; i < input.rule.actions.length; i++) {
      const rawAction = input.rule.actions[i]
      const executor = actionExecutorFor(rawAction.kind)
      // Thay biến trong các trường input của action trước khi thực thi (theo kind).
      const action = substituteVarsInRecord(
        rawAction as unknown as Record<string, unknown>,
        [...executor.substFields],
        ctx,
      ) as unknown as AutomationAction

      const step: AutomationStepResult = {
        index: i + 1,
        status: 'running',
        ...(action.name ? { name: action.name } : {}),
        input: executor.buildInput(action),
      }
      run.steps.push(step)

      const executed = await executor.execute(action, { input, runId: run.runId })

      if (executed.taskId) step.taskId = executed.taskId
      if (executed.jobId) step.jobId = executed.jobId

      if (executed.error) {
        step.status = executed.skipped ? 'skipped' : 'failed'
        step.error = executed.error
        outcome = executed.skipped ? 'skipped' : 'failed'
        error = executed.error
        break
      }

      if (executed.jobId) {
        // Có job thật (runTask hoặc runCommand) — chờ tới trạng thái terminal như cũ.
        const job = await waitJobTerminal(executed.jobId, stepTimeoutMs())
        if (!job) {
          step.status = 'failed'
          step.error = 'job vanished while waiting'
          outcome = 'failed'
          error = step.error
          break
        }
        step.status = job.status
        if (job.status !== 'succeeded') {
          step.error = job.error || `job ${job.status}`
          outcome = 'failed'
          error = `step ${i + 1}: ${step.error}`
          break
        }
        step.stdout = stdoutOf(job)
        // Artifact đọc theo root của CHÍNH bước đó — bước cross-project nằm ở data root khác.
        if (step.taskId) step.artifacts = artifactsOf(executed.root ?? input.root, step.taskId)
      } else {
        // Không tạo job — kết quả chạy đồng bộ (httpRequest).
        step.status = 'succeeded'
        step.stdout = executed.stdout ?? ''
      }
      ctx.steps.push(step)

      // Progress ghi dần để history poll thấy từng bước.
      saveRun(run)
    }
  } catch (err: any) {
    outcome = 'failed'
    error = String(err?.message ?? err)
  }

  run.outcome = outcome
  run.finishedAt = new Date().toISOString()
  if (error) run.error = error
  saveRun(run)
  setRuleState(input.projectId, input.rule.id, {
    lastRunAt: stateBase.lastRunAt,
    lastOutcome: outcome,
    inFlight: false,
  })

  if (outcome === 'succeeded') {
    emit('automation.run_succeeded', {
      automationId: input.rule.id,
      projectId: input.projectId || undefined,
      runId: run.runId,
      taskId: run.steps?.[run.steps.length - 1]?.taskId,
      jobId: run.steps?.[run.steps.length - 1]?.jobId,
    })
  } else {
    emit('automation.run_failed', {
      automationId: input.rule.id,
      projectId: input.projectId || undefined,
      runId: run.runId,
      outcome,
      error,
      taskId: run.steps?.[run.steps.length - 1]?.taskId,
    })
  }
}

/**
 * Kích hoạt rule một lần: ghi run + state, emit `automation.triggered`, rồi
 * chạy nền chuỗi action. Trả về run record đang `running` — kết quả cuối
 * nằm trong history (UI poll) và event `automation.run_succeeded|run_failed`.
 */
export function runAutomation(input: AutomationRunnerInput): AutomationRun {
  const { projectId, rule, source } = input
  const startedAt = new Date().toISOString()
  const runId = randomUUID()

  // Đánh dấu chạy trước khi execute: lastRunAt neo lịch due kế tiếp, inFlight chặn
  // trigger chạy chồng, one-shot `once` tới hạn coi như đã kích hoạt dù action fail.
  const prevState = getRuleState(projectId, rule.id)
  const triggerFired = {
    ...(prevState.triggerFired ?? {}),
    ...firedOnceTriggersAtRun(rule.triggers, new Date()),
  }
  const state = {
    lastRunAt: startedAt,
    lastOutcome: 'running' as AutomationRunOutcome,
    triggerFired,
    inFlight: true,
  }
  setRuleState(projectId, rule.id, state)

  // One-shot đã chạy → disable ngay trong file YAML: runtime state ở registryHome
  // mất khi redeploy docker, còn rule file ở data root (volume mount) nên bền vững.
  if (disableIfAllOnceTriggersSpent(input.root, rule)) {
    syncTriggerRegistry(input.root, String(projectId || ''))
    emit('entity.updated', {
      entity: 'automation',
      id: rule.id,
      projectId: projectId || undefined,
      detail: { enabled: false, reason: 'one-shot spent' },
    })
  }

  const matchedTrigger = rule.triggers.find((t) => t.id === input.triggerId)
  const run: AutomationRun = {
    version: 1,
    runId,
    automationId: rule.id,
    projectId: String(projectId || ''),
    source,
    triggerId: input.triggerId ?? 'manual',
    triggerKind: matchedTrigger?.kind ?? source,
    startedAt,
    finishedAt: null,
    outcome: 'running',
    steps: [],
  }
  saveRun(run)

  emit('automation.triggered', {
    automationId: rule.id,
    projectId: projectId || undefined,
    runId,
    triggerKind: run.triggerKind,
    source,
  })

  // Nền — scheduler tick không chờ chuỗi dài (job agent tính bằng phút).
  void executeSequence(input, run, { lastRunAt: startedAt }).catch((err) => {
    console.warn(`[automations] sequence crashed for ${rule.id}:`, err)
  })

  return run
}
