/**
 * Action `runCommand`: submit job qua runner đã cấu hình (khuyến nghị provider
 * họ `console-command`), `params` là argv tự do. `agentRef` để rỗng — job queue
 * bỏ qua agent với họ `console-command`. Mỗi lần chạy một workspace riêng dưới
 * `automations/<ruleId>/runs/<runId>/`.
 */

import { joinPath, mkdirSync, randomBytes } from '../../../../backend/lib/fileHelper.js'
import { submitJob } from '../peers.js'
import {
  capText,
  STEP_INPUT_FIELD_CAP,
  type ActionRunContext,
  type AutomationActionExecutor,
  type AutomationActionOf,
  type StepExecution,
} from './AutomationActionExecutor.js'

type RunCommandAction = AutomationActionOf<'runCommand'>

export class RunCommandExecutor implements AutomationActionExecutor<'runCommand'> {
  readonly kind = 'runCommand' as const
  readonly substFields = ['name', 'description', 'runnerId', 'params'] as const

  buildInput(action: RunCommandAction): Record<string, unknown> {
    return {
      runnerId: action.runnerId,
      ...(action.params ? { params: capText(action.params, STEP_INPUT_FIELD_CAP) } : {}),
    }
  }

  async execute(action: RunCommandAction, { input, runId }: ActionRunContext): Promise<StepExecution> {
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
}
