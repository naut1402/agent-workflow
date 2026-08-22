/**
 * Thực thi action của automation rule (#233). P0 chỉ có `runTask`:
 * - mode=create  : đường `createTask` + `submitJob` (createTaskRun) — giống
 *                  `POST /api/tasks` với `run: true`.
 * - mode=existing: đường business `runTaskStep` của monitor (lock / HITL /
 *                  busy 409 / auto-advance) — task đang bận → outcome `skipped`.
 *
 * Mỗi lần chạy ghi 1 bản ghi run (runId) + cập nhật rule state; emit
 * `automation.triggered` / `automation.run_succeeded` / `automation.run_failed`.
 */

import { dirname, joinPath, randomBytes, randomUUID } from '../../../core/lib/fileHelper.js'
import { emit } from '../../../core/events/index.js'
import { submitJob } from '../../runner/business/index.js'
import { createTask, runTaskStep } from '../../monitor/business/index.js'
import type { AutomationRuleRecord } from '../schemas/automation.js'
import {
  saveRun,
  setRuleState,
  type AutomationRun,
  type AutomationRunOutcome,
} from './runLedger.js'

export type AutomationRunSource = 'manual' | 'schedule' | 'event'

export interface RunAutomationInput {
  root: string
  projectId: string | null
  rule: AutomationRuleRecord
  source: AutomationRunSource
}

/** Task id do automation sinh — tuân TASK_ID_PATTERN, dễ nhận diện nguồn. */
function mintAutomationTaskId(): string {
  return `auto-${randomBytes(4).toString('hex')}`
}

interface ActionResult {
  taskId?: string
  jobId?: string
  /** true khi không phải lỗi nhưng bỏ qua lượt chạy (task đang bận). */
  skipped?: boolean
  error?: string
}

async function executeCreateAction(
  input: RunAutomationInput,
  runId: string,
): Promise<ActionResult> {
  const action = input.rule.action
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
      projectRoot: dirname(input.root),
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
): Promise<ActionResult> {
  const action = input.rule.action
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

/**
 * Chạy action của rule một lần. Không ném lỗi — mọi thất bại nằm trong run
 * record (outcome failed/skipped) để UI + event phản ánh đúng.
 */
export async function runAutomation(input: RunAutomationInput): Promise<AutomationRun> {
  const { projectId, rule, source } = input
  const startedAt = new Date().toISOString()
  const runId = randomUUID()

  // Đánh dấu chạy trước khi execute: lastRunAt neo lịch tính due kế tiếp,
  // inFlight chặn event-trigger chạy chồng; one-shot `time` coi như đã kích
  // hoạt (kể cả khi action fail thì không chạy lại).
  const state = {
    lastRunAt: startedAt,
    lastOutcome: 'running' as AutomationRunOutcome,
    ...(rule.trigger.kind === 'time' ? { fired: true } : {}),
    inFlight: true,
  }
  setRuleState(projectId, rule.id, state)

  const run: AutomationRun = {
    version: 1,
    runId,
    automationId: rule.id,
    projectId: String(projectId || ''),
    source,
    triggerKind: rule.trigger.kind,
    startedAt,
    finishedAt: null,
    outcome: 'running',
  }
  saveRun(run)

  emit('automation.triggered', {
    automationId: rule.id,
    projectId: projectId || undefined,
    runId,
    triggerKind: rule.trigger.kind,
    source,
  })

  let outcome: AutomationRunOutcome = 'succeeded'
  let error: string | undefined
  try {
    const result =
      rule.action.mode === 'create'
        ? await executeCreateAction(input, runId)
        : await executeExistingAction(input)
    if (result.taskId) run.taskId = result.taskId
    if (result.jobId) run.jobId = result.jobId
    if (result.error) {
      error = result.error
      outcome = result.skipped ? 'skipped' : 'failed'
    }
  } catch (err: any) {
    error = String(err?.message ?? err)
    outcome = 'failed'
  }

  run.outcome = outcome
  run.finishedAt = new Date().toISOString()
  if (error) run.error = error
  saveRun(run)
  setRuleState(projectId, rule.id, { ...state, lastOutcome: outcome, inFlight: false })

  if (outcome === 'succeeded') {
    emit('automation.run_succeeded', {
      automationId: rule.id,
      projectId: projectId || undefined,
      runId,
      taskId: run.taskId,
      jobId: run.jobId,
    })
  } else {
    emit('automation.run_failed', {
      automationId: rule.id,
      projectId: projectId || undefined,
      runId,
      outcome,
      error,
      taskId: run.taskId,
    })
  }

  return run
}
