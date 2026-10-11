/**
 * Action `runTask` — hai mode:
 * - `create`: tạo task mới từ prompt rồi khởi chạy step đầu (pipeline có node
 *   điều phối ⇒ giao cho node đó, không có job để chờ).
 * - `existing`: chạy step hiện tại của task có sẵn qua `runTaskStep` (409 task
 *   bận / 403 task do node điều phối giữ ⇒ ghi `skipped`).
 * Cả hai chạy trên project đích (`projectId`) nếu action khai.
 */

import { joinPath, randomBytes } from '../../../../backend/lib/fileHelper.js'
import { emit } from '../../../../backend/events/index.js'
import { get as getProject } from '../../../../backend/registry.js'
import {
  createTask,
  dispatchOrchestrator,
  resolveOrchestration,
  resolveStepRunnerId,
  runTaskStep,
  submitJob,
} from '../peers.js'
import type { AutomationRunnerInput } from '../AutomationRunner.js'
import {
  capText,
  STEP_INPUT_FIELD_CAP,
  type ActionRunContext,
  type AutomationActionExecutor,
  type AutomationActionOf,
  type StepExecution,
} from './AutomationActionExecutor.js'

type RunTaskAction = AutomationActionOf<'runTask'>

interface ActionTarget {
  root: string
  projectId: string | null
}

/**
 * Project mà một action `runTask` thực sự chạy trên đó.
 * - Không set / rỗng → project sở hữu rule (hành vi trước khi có field này).
 * - Trùng project của rule → cũng dùng thẳng `input`: rule có thể chạy với
 *   `projectId` không nằm trong registry (test, `DEV_TEAM_ROOT` seed), không
 *   được biến trường hợp đó thành lỗi.
 * - Id lạ / registry đọc hỏng (`loadRegistry` nuốt lỗi trả rỗng) → lỗi tường
 *   minh, KHÔNG fallback: chạy nhầm project là thứ field này phải chặn.
 */
function resolveActionTarget(
  input: AutomationRunnerInput,
  action: RunTaskAction,
): ActionTarget | { error: string } {
  const id = (action.projectId ?? '').trim()
  if (!id || id === input.projectId) return { root: input.root, projectId: input.projectId }

  const project = getProject(id)
  if (!project) return { error: `unknown target project: ${id}` }
  return { root: project.path, projectId: project.id }
}

/** Task id do automation sinh — tuân TASK_ID_PATTERN, dễ nhận diện nguồn. */
function mintAutomationTaskId(): string {
  return `auto-${randomBytes(4).toString('hex')}`
}

type CreateTaskResult = Awaited<ReturnType<typeof createTask>>

/**
 * Tạo task từ prompt với id tự mint. Mint + retry: id gần như không trùng, nhưng
 * 409 thì thử lại vài lần thay vì fail cả run; lỗi khác trả thẳng `error`.
 */
async function createAutomationTask(
  root: string,
  prompt: string,
  profileName: string | undefined,
): Promise<Exclude<CreateTaskResult, { error: string }> | { error: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await createTask(root, { taskId: mintAutomationTaskId(), source: 'prompt', prompt, profileName })
    if (!('error' in result)) return result
    if (result.status !== 409 || attempt >= 2) return { error: result.error }
  }
  return { error: 'failed to create task' }
}

export class RunTaskExecutor implements AutomationActionExecutor<'runTask'> {
  readonly kind = 'runTask' as const
  // `projectId` cố ý không thay biến — `{`/`}` trượt regex của schema.
  readonly substFields = ['name', 'description', 'prompt', 'taskId', 'profileName', 'runnerId'] as const

  buildInput(action: RunTaskAction): Record<string, unknown> {
    return action.mode === 'create'
      ? {
          mode: 'create',
          prompt: capText(action.prompt ?? '', STEP_INPUT_FIELD_CAP),
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

  execute(action: RunTaskAction, run: ActionRunContext): Promise<StepExecution> {
    return action.mode === 'create'
      ? this.executeCreate(action, run)
      : this.executeExisting(action, run.input)
  }

  private async executeCreate(
    action: RunTaskAction,
    { input, runId }: ActionRunContext,
  ): Promise<StepExecution> {
    if (action.mode !== 'create' || !action.prompt) {
      return { error: 'action misconfigured: prompt required for mode=create' }
    }

    // Resolve trước khi tạo bất cứ thứ gì — project đích hỏng thì không để lại task rác.
    const target = resolveActionTarget(input, action)
    if ('error' in target) return { error: target.error }

    const created = await createAutomationTask(target.root, action.prompt, action.profileName ?? undefined)
    if ('error' in created) return { error: created.error }

    const agentRef = created.firstStep?.agent
    if (typeof agentRef !== 'string' || !agentRef) {
      return { taskId: created.taskId, root: target.root, error: 'pipeline has no first-step agent' }
    }

    // Pipeline có node điều phối ⇒ giao cho nó (như nhánh "Chạy ngay" của createTask);
    // không có jobId để chờ, tiến độ theo dõi qua event `orchestrator.*`.
    const orchestration = await resolveOrchestration(target.root, created.taskId)
    if (orchestration.active) {
      await dispatchOrchestrator(target.root, target.projectId, created.taskId, 'task_created')
      return { taskId: created.taskId, root: target.root }
    }

    const job = submitJob({
      // Action khai runner tường minh thì thắng pin của step đầu.
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
        // Rule vẫn thuộc project gốc — đây là đường truy vết ngược job → rule.
        automationId: input.rule.id,
        automationRunId: runId,
      },
    })
    return { taskId: created.taskId, jobId: job.id, root: target.root }
  }

  private async executeExisting(action: RunTaskAction, input: AutomationRunnerInput): Promise<StepExecution> {
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
      // 409 = task đang có job chạy — không phải lỗi cấu hình, ghi skipped.
      if (result.status === 409) {
        return { taskId: action.taskId, root: target.root, skipped: true, error: 'task busy — step already running' }
      }
      // 403 = task do orchestrator điều phối — ghi `skipped` (không `failed`) để không
      // biến automation đang chạy tốt thành đỏ hàng loạt; phát tín hiệu để orchestrator tự quyết.
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
}
