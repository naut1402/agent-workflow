import { dirname, joinPath, readTextFile } from '../../../../backend/lib/fileHelper.js'
import { isRunnableTarget } from '../../lib/pipelineRunGuards.js'
import { loadPipelineConfig } from '../peers.js'
import { listJobs, resolveStepRunnerId, submitJob } from '../index.js'
import type { JobRecord } from '../index.js'
import { readState } from './index.js'
import { assertStartAllowed, type StartOrigin } from './startAuthority.js'
import {
  advanceStepOnJobSuccessAssumingLock,
  jumpToPipelineStepAssumingLock,
  reconcileGateStateAssumingLock,
  withTaskLock,
} from './state.js'

export interface RunTaskStepInput {
  runnerId?: string | null
  /** Step đích khi nhảy/chuỗi (run-step với target). */
  targetStepId?: string | null
  skipIntermediate?: boolean
  /** Ai gọi — quyết định có qua được `assertStartAllowed` khi orchestrator đang điều phối. */
  origin?: StartOrigin
  /** Prompt thay cho `request.md` thô; `request.md` vẫn phải tồn tại. */
  userPrompt?: string
}

export type RunTaskStepResult =
  | { ok: true; job: JobRecord; stepId: string; skipIntermediate: boolean }
  | { ok: false; status: number; error: string; extra?: Record<string, unknown> }

// xem docs/architecture/code/monitor.md §6
export async function runTaskStep(
  root: string,
  projectId: string | null,
  taskId: string,
  input: RunTaskStepInput,
): Promise<RunTaskStepResult> {
  const startCheck = await assertStartAllowed(root, taskId, input.origin ?? 'manual')
  if ('error' in startCheck) {
    return { ok: false, status: startCheck.status, error: startCheck.error, extra: { taskId } }
  }

  return withTaskLock(root, taskId, async () => {
    const stateFile = joinPath(root, '.dev-state', `${taskId}.json`)
    let read = await readState(stateFile)
    if (!read.ok) return { ok: false, status: 404, error: 'task not found', extra: { taskId } }
    let state = read.state as Record<string, unknown>

    // xem docs/architecture/code/monitor.md §6
    const existing = listJobs(50).find(
      (j) =>
        j.metadata?.taskId === taskId &&
        (!j.metadata?.devTeamRoot || j.metadata.devTeamRoot === root) &&
        j.metadata?.orchestratorJob !== true &&
        (j.status === 'queued' || j.status === 'running'),
    )
    if (existing) {
      return { ok: false, status: 409, error: 'step already running', extra: { taskId, job: existing } }
    }

    // xem docs/architecture/code/monitor.md §6
    const reconciled = await reconcileGateStateAssumingLock(root, taskId, stateFile, { state })
    if (reconciled) state = reconciled.state

    if (state.hitl_pending) {
      return { ok: false, status: 400, error: 'task is waiting for HITL approval', extra: { taskId } }
    }

    let stepId = String(state.current_phase ?? '')

    // xem docs/architecture/code/monitor.md §7
    const pinned = input.origin === 'orchestrator' && !!input.targetStepId

    const resetAt = typeof state.last_reset_at === 'string' ? state.last_reset_at : null
    const lastSucceeded = pinned ? undefined : listJobs(200).find(
      (j) =>
        j.metadata?.taskId === taskId &&
        (!j.metadata?.devTeamRoot || j.metadata.devTeamRoot === root) &&
        j.status === 'succeeded' &&
        !j.applyTarget &&
        j.metadata?.respawn !== true &&
        j.metadata?.pipelineStepId === stepId &&
        (!resetAt || (typeof j.finishedAt === 'string' && j.finishedAt > resetAt)),
    )
    if (lastSucceeded && stepId) {
      await advanceStepOnJobSuccessAssumingLock(root, taskId, stepId, stateFile)
      read = await readState(stateFile)
      if (!read.ok) return { ok: false, status: 404, error: 'task not found', extra: { taskId } }
      state = read.state as Record<string, unknown>
      if (state.hitl_pending) {
        return { ok: false, status: 400, error: 'task is waiting for HITL approval', extra: { taskId } }
      }
      stepId = String(state.current_phase ?? '')
    }

    const pipeline = await loadPipelineConfig(root, taskId)
    const phaseKeys = (pipeline.steps || []).map((s: any) => s.id).filter(Boolean)
    const target = input.targetStepId ?? undefined
    const skip = input.skipIntermediate === true && !!target && target !== stepId
    // xem docs/architecture/code/monitor.md §7
    const chainTarget = !skip && !!target && target !== stepId

    if ((skip || chainTarget) && target) {
      if (!phaseKeys.includes(target) || !isRunnableTarget(phaseKeys, stepId, target)) {
        return {
          ok: false,
          status: 400,
          error: 'invalid target step',
          extra: { taskId, stepId, targetStepId: target },
        }
      }
    }

    const runStepId = skip && target ? target : stepId
    const step = (pipeline.steps || []).find((s: any) => s.id === runStepId)
    if (!step?.agent) {
      return { ok: false, status: 400, error: 'no runnable current step', extra: { taskId, stepId: runStepId } }
    }

    const requestFile = joinPath(root, 'tasks', taskId, 'request.md')
    let userPrompt: string
    try {
      userPrompt = await readTextFile(requestFile)
    } catch {
      return { ok: false, status: 404, error: 'request.md not found', extra: { taskId } }
    }
    if (input.userPrompt?.trim()) userPrompt = input.userPrompt

    if (skip && target) {
      const jumped = await jumpToPipelineStepAssumingLock(stateFile, target)
      if ('error' in jumped) {
        return { ok: false, status: jumped.status, error: jumped.error, extra: { taskId } }
      }
      state = jumped.state
      stepId = target
    }

    const job = submitJob({
      runnerId: input.runnerId ?? resolveStepRunnerId(step).runnerId,
      agentRef: step.agent,
      workspace: joinPath(root, 'tasks', taskId),
      userPrompt,
      produces: Array.isArray(step.produces) ? step.produces : undefined,
      sessionMode: 'new',
      metadata: {
        projectRoot: dirname(root),
        devTeamRoot: root,
        projectId: projectId || undefined,
        taskId,
        pipelineStepId: stepId,
        ...(chainTarget && target ? { chainTarget: target } : {}),
        // xem docs/architecture/code/monitor.md §5
        ...(input.origin === 'orchestrator' ? { orchestratorDispatch: true } : {}),
      },
    })

    return { ok: true, job, stepId, skipIntermediate: skip }
  })
}
