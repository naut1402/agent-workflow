/**
 * Thực thi chuỗi action của automation rule (#233). Action chạy **tuần tự**;
 * mỗi bước chờ job của nó kết thúc rồi capture stdout + artifacts làm biến
 * (`{{steps.N.stdout}}`, `{{steps.N.artifacts.<name>}}`) cho bước sau.
 *
 * Chuỗi chạy nền (fire-and-forget) để không chặn tick scheduler — state
 * `inFlight` phủ toàn chuỗi, chặn event-trigger chạy chồng. Mọi thất bại nằm
 * trong run record (outcome failed/skipped), không ném lỗi lên caller.
 */

import { joinPath, randomBytes, randomUUID, readTextFileSync, readdirSync } from '../../../core/lib/fileHelper.js'
import { emit } from '../../../core/events/index.js'
import { submitJob, loadJob } from '../../runner/business/index.js'
import type { JobRecord } from '../../runner/business/index.js'
import { createTask, runTaskStep } from '../../monitor/business/index.js'
import type {
  AutomationRuleRecord,
  AutomationRun,
  AutomationRunOutcome,
  AutomationStepResult,
  RunTaskAction,
} from '../schemas/automation.js'
import { firedOnceTriggersAtRun } from './matcher.js'
import { disableIfAllOnceTriggersSpent, syncTriggerRegistry } from './rules.js'
import {
  getRuleState,
  saveRun,
  setRuleState,
} from './runLedger.js'
import { substituteVarsInRecord, type AutomationVarsContext, type TriggerContext } from '../lib/vars.js'

export type AutomationRunSource = 'manual' | 'schedule' | 'event'

export interface RunAutomationInput {
  root: string
  projectId: string | null
  rule: AutomationRuleRecord
  source: AutomationRunSource
  /** Trigger khớp (schedule/event) — dựng context biến + đánh dấu fired. */
  triggerId?: string
  /** Payload event gốc khi source=event. */
  event?: { type: string; payload: Record<string, unknown> }
}

/** Timeout chờ mỗi bước job xong — mặc định 30 phút, override bằng env. */
export function stepTimeoutMs(): number {
  const raw = Number(process.env.AUTOMATION_STEP_TIMEOUT_MS || '')
  if (Number.isFinite(raw) && raw >= 30_000) return Math.floor(raw)
  return 30 * 60_000
}

const POLL_INTERVAL_MS = 1_500
const STDOUT_CAP = 64_000
const ARTIFACT_EACH_CAP = 32_000
const ARTIFACT_TOTAL_CAP = 128_000

/** Task id do automation sinh — tuân TASK_ID_PATTERN, dễ nhận diện nguồn. */
function mintAutomationTaskId(): string {
  return `auto-${randomBytes(4).toString('hex')}`
}

function cap(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text
}

/** stdout của job: ưu tiên `job.stdout` (persist cho agent-CLI), fallback log file. */
function stdoutOf(job: JobRecord): string {
  if (typeof job.stdout === 'string' && job.stdout.trim()) return cap(job.stdout, STDOUT_CAP)
  if (!job.logPath) return ''
  try {
    return cap(readTextFileSync(job.logPath), STDOUT_CAP)
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
      const content = cap(readTextFileSync(joinPath(dir, f)), ARTIFACT_EACH_CAP)
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

interface StepExecution {
  taskId?: string
  jobId?: string
  skipped?: boolean
  error?: string
}

async function executeCreateAction(
  input: RunAutomationInput,
  action: RunTaskAction,
  runId: string,
): Promise<StepExecution> {
  if (action.mode !== 'create' || !action.prompt) {
    return { error: 'action misconfigured: prompt required for mode=create' }
  }

  // Mint + retry: id ngẫu nhiên gần như không trùng, nhưng 409 thì thử lại
  // vài lần thay vì fail cả run.
  let created: Awaited<ReturnType<typeof createTask>> | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await createTask(input.root, {
      taskId: mintAutomationTaskId(),
      source: 'prompt',
      prompt: action.prompt,
      profileName: action.profileName ?? undefined,
    })
    if ('error' in result) {
      if (result.status === 409 && attempt < 2) continue
      return { error: result.error }
    }
    created = result
    break
  }
  if (!created || 'error' in created) {
    return { error: 'failed to create task' }
  }

  const agentRef = created.firstStep?.agent
  if (typeof agentRef !== 'string' || !agentRef) {
    return { taskId: created.taskId, error: 'pipeline has no first-step agent' }
  }

  const job = submitJob({
    runnerId: action.runnerId ?? undefined,
    agentRef,
    workspace: joinPath(input.root, 'tasks', created.taskId),
    userPrompt: created.requestContent,
    metadata: {
      projectRoot: joinPath(input.root, '..'),
      devTeamRoot: input.root,
      projectId: input.projectId || undefined,
      taskId: created.taskId,
      pipelineStepId: created.firstStep.id,
      createTaskRun: true,
      automationId: input.rule.id,
      automationRunId: runId,
    },
  })
  return { taskId: created.taskId, jobId: job.id }
}

async function executeExistingAction(
  input: RunAutomationInput,
  action: RunTaskAction,
): Promise<StepExecution> {
  if (action.mode !== 'existing' || !action.taskId) {
    return { error: 'action misconfigured: taskId required for mode=existing' }
  }
  const result = await runTaskStep(input.root, input.projectId, action.taskId, {
    runnerId: action.runnerId ?? null,
  })
  if ('error' in result) {
    // 409 = task đang có job chạy — không phải lỗi cấu hình, ghi skipped.
    if (result.status === 409) {
      return { taskId: action.taskId, skipped: true, error: 'task busy — step already running' }
    }
    return { taskId: action.taskId, error: result.error }
  }
  return { taskId: action.taskId, jobId: result.job.id }
}

function triggerContextOf(input: RunAutomationInput): TriggerContext {
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
  input: RunAutomationInput,
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
      // Thay biến trong các trường input của action trước khi thực thi.
      const action = substituteVarsInRecord(rawAction, ['name', 'description', 'prompt', 'taskId', 'profileName', 'runnerId'], ctx) as RunTaskAction

      const step: AutomationStepResult = {
        index: i + 1,
        status: 'running',
        ...(action.name ? { name: action.name } : {}),
      }
      run.steps.push(step)

      const executed =
        action.mode === 'create'
          ? await executeCreateAction(input, action, run.runId)
          : await executeExistingAction(input, action)

      if (executed.taskId) step.taskId = executed.taskId
      if (executed.jobId) step.jobId = executed.jobId

      if (executed.error) {
        step.status = executed.skipped ? 'skipped' : 'failed'
        step.error = executed.error
        outcome = executed.skipped ? 'skipped' : 'failed'
        error = executed.error
        break
      }

      // Chờ job của bước này xong mới capture output / chạy bước kế.
      const job = await waitJobTerminal(executed.jobId!, stepTimeoutMs())
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
      if (step.taskId) step.artifacts = artifactsOf(input.root, step.taskId)
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
 * **chạy nền** chuỗi action. Trả về run record đang `running` — kết quả cuối
 * nằm trong history (UI poll) và event `automation.run_succeeded|run_failed`.
 */
export function runAutomation(input: RunAutomationInput): AutomationRun {
  const { projectId, rule, source } = input
  const startedAt = new Date().toISOString()
  const runId = randomUUID()

  // Đánh dấu chạy trước khi execute: lastRunAt neo lịch tính due kế tiếp,
  // inFlight chặn event-trigger chạy chồng; one-shot `once` tới hạn coi như
  // đã kích hoạt (kể cả khi action fail thì không chạy lại).
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

  // Rule thuần one-shot đã chạy → disable NGAY TRONG FILE YAML: runtime state
  // ở registryHome mất khi redeploy docker (container mới), còn rule file ở
  // data root (volume mount) nên đây là lớp chặn chạy lại bền vững.
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
