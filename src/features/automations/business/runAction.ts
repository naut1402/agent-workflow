import { joinPath, mkdirSync, randomBytes, randomUUID, readTextFileSync, readdirSync } from '../../../backend/lib/fileHelper.js'
import { emit } from '../../../backend/events/index.js'
import { get as getProject } from '../../../backend/registry.js'
import { submitJob, loadJob, resolveStepRunnerId } from '../../runner/business/index.js'
import type { JobRecord } from '../../runner/business/index.js'
import { createTask, fetchUrlSafe, resolveOrchestration, runTaskStep } from '../../monitor/business/index.js'
import { dispatchOrchestrator } from '../../orchestrator/business/index.js'
import type {
  AutomationAction,
  AutomationRuleRecord,
  AutomationRun,
  AutomationRunOutcome,
  AutomationStepResult,
  HttpRequestAction,
  RunCommandAction,
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
const INPUT_FIELD_CAP = 4_000

function buildStepInput(action: AutomationAction): Record<string, unknown> {
  if (action.kind === 'httpRequest') {
    return {
      method: action.method,
      url: action.url,
      ...(action.headers ? { headers: action.headers } : {}),
      ...(action.body ? { body: cap(action.body, INPUT_FIELD_CAP) } : {}),
    }
  }
  if (action.kind === 'runCommand') {
    return {
      runnerId: action.runnerId,
      ...(action.params ? { params: cap(action.params, INPUT_FIELD_CAP) } : {}),
    }
  }
  return action.mode === 'create'
    ? {
        mode: 'create',
        prompt: cap(action.prompt ?? '', INPUT_FIELD_CAP),
        ...(action.profileName ? { profileName: action.profileName } : {}),
        ...(action.runnerId ? { runnerId: action.runnerId } : {}),
        ...(action.projectId ? { projectId: action.projectId } : {}),
      }
    : {
        mode: 'existing',
        taskId: action.taskId,
        ...(action.runnerId ? { runnerId: action.runnerId } : {}),
        ...(action.projectId ? { projectId: action.projectId } : {}),
      }
}

interface ActionTarget {
  root: string
  projectId: string | null
}

// xem docs/architecture/code/automations.md §1
function resolveActionTarget(
  input: RunAutomationInput,
  action: RunTaskAction,
): ActionTarget | { error: string } {
  const id = (action.projectId ?? '').trim()
  if (!id || id === input.projectId) return { root: input.root, projectId: input.projectId }

  const project = getProject(id)
  if (!project) return { error: `unknown target project: ${id}` }
  return { root: project.path, projectId: project.id }
}

function mintAutomationTaskId(): string {
  return `auto-${randomBytes(4).toString('hex')}`
}

function cap(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text
}

function stdoutOf(job: JobRecord): string {
  if (typeof job.stdout === 'string' && job.stdout.trim()) return cap(job.stdout, STDOUT_CAP)
  if (!job.logPath) return ''
  try {
    return cap(readTextFileSync(job.logPath), STDOUT_CAP)
  } catch {
    return ''
  }
}

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
  root?: string
  stdout?: string
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

  // xem docs/architecture/code/automations.md §1
  const target = resolveActionTarget(input, action)
  if ('error' in target) return { error: target.error }

  let created: Awaited<ReturnType<typeof createTask>> | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await createTask(target.root, {
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
    return { taskId: created.taskId, root: target.root, error: 'pipeline has no first-step agent' }
  }

  const orchestration = await resolveOrchestration(target.root, created.taskId)
  if (orchestration.active) {
    await dispatchOrchestrator(target.root, target.projectId, created.taskId, 'task_created')
    return { taskId: created.taskId, root: target.root }
  }

  const job = submitJob({
    runnerId: action.runnerId ?? resolveStepRunnerId(created.firstStep).runnerId,
    agentRef,
    workspace: joinPath(target.root, 'tasks', created.taskId),
    userPrompt: created.requestContent,
    metadata: {
      projectRoot: joinPath(target.root, '..'),
      devTeamRoot: target.root,
      projectId: target.projectId || undefined,
      taskId: created.taskId,
      pipelineStepId: created.firstStep.id,
      createTaskRun: true,
      automationId: input.rule.id,
      automationRunId: runId,
    },
  })
  return { taskId: created.taskId, jobId: job.id, root: target.root }
}

async function executeExistingAction(
  input: RunAutomationInput,
  action: RunTaskAction,
): Promise<StepExecution> {
  if (action.mode !== 'existing' || !action.taskId) {
    return { error: 'action misconfigured: taskId required for mode=existing' }
  }
  const target = resolveActionTarget(input, action)
  if ('error' in target) return { error: target.error }

  const result = await runTaskStep(target.root, target.projectId, action.taskId, {
    runnerId: action.runnerId ?? null,
    origin: 'automation',
  })
  if ('error' in result) {
    if (result.status === 409) {
      return { taskId: action.taskId, root: target.root, skipped: true, error: 'task busy — step already running' }
    }
    if (result.status === 403) {
      emit('orchestrator.start_requested', {
        taskId: action.taskId,
        projectId: target.projectId || undefined,
        devTeamRoot: target.root,
        automationId: input.rule.id,
      })
      return {
        taskId: action.taskId,
        root: target.root,
        skipped: true,
        error: 'task is orchestrated — start requested via orchestrator',
      }
    }
    return { taskId: action.taskId, root: target.root, error: result.error }
  }
  return { taskId: action.taskId, jobId: result.job.id, root: target.root }
}

async function executeHttpRequestAction(action: HttpRequestAction): Promise<StepExecution> {
  try {
    const text = await fetchUrlSafe(action.url, {
      method: action.method,
      headers: action.headers,
      body: action.body,
    })
    return { stdout: cap(text, STDOUT_CAP) }
  } catch (err: any) {
    return { error: String(err?.message ?? err) }
  }
}

async function executeRunCommandAction(
  input: RunAutomationInput,
  action: RunCommandAction,
  runId: string,
): Promise<StepExecution> {
  const workspace = joinPath(
    input.root,
    'automations',
    input.rule.id,
    'runs',
    runId,
    `cmd-${randomBytes(3).toString('hex')}`,
  )
  mkdirSync(workspace, { recursive: true })
  const job = submitJob({
    runnerId: action.runnerId,
    agentRef: '',
    workspace,
    userPrompt: action.params ?? '',
    metadata: {
      projectRoot: joinPath(input.root, '..'),
      devTeamRoot: input.root,
      projectId: input.projectId || undefined,
      automationId: input.rule.id,
      automationRunId: runId,
    },
  })
  return { jobId: job.id }
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
      const substFields =
        rawAction.kind === 'httpRequest'
          ? ['name', 'description', 'url', 'body']
          : rawAction.kind === 'runCommand'
            ? ['name', 'description', 'runnerId', 'params']
            : ['name', 'description', 'prompt', 'taskId', 'profileName', 'runnerId']
      const action = substituteVarsInRecord(
        rawAction as unknown as Record<string, unknown>,
        substFields,
        ctx,
      ) as unknown as AutomationAction

      const step: AutomationStepResult = {
        index: i + 1,
        status: 'running',
        ...(action.name ? { name: action.name } : {}),
        input: buildStepInput(action),
      }
      run.steps.push(step)

      const executed =
        action.kind === 'httpRequest'
          ? await executeHttpRequestAction(action)
          : action.kind === 'runCommand'
            ? await executeRunCommandAction(input, action, run.runId)
            : action.mode === 'create'
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

      if (executed.jobId) {
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
        // xem docs/architecture/code/automations.md §1
        if (step.taskId) step.artifacts = artifactsOf(executed.root ?? input.root, step.taskId)
      } else {
        step.status = 'succeeded'
        step.stdout = executed.stdout ?? ''
      }
      ctx.steps.push(step)

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
export function runAutomation(input: RunAutomationInput): AutomationRun {
  const { projectId, rule, source } = input
  const startedAt = new Date().toISOString()
  const runId = randomUUID()

  // xem docs/architecture/code/automations.md §2
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

  // xem docs/architecture/code/automations.md §2
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

  void executeSequence(input, run, { lastRunAt: startedAt }).catch((err) => {
    console.warn(`[automations] sequence crashed for ${rule.id}:`, err)
  })

  return run
}
