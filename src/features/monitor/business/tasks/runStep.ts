/**
 * Core của "chạy task có sẵn" — tách từ MonitorController.runTaskStep để
 * automations (#233) tái sử dụng đúng một đường: serialise per-task
 * (withTaskLock), chặn HITL pending, chặn job đang chạy (409), auto-advance
 * qua step đã succeeded, rồi submit job bước hiện tại.
 *
 * Trả kết quả thuần (không biết HTTP) — controller map sang response.
 */

import { dirname, joinPath, readTextFile } from '../../../../core/lib/fileHelper.js'
import { isRunnableTarget } from '../../lib/pipelineRunGuards.js'
import { loadPipelineConfig } from '../peers.js'
import { listJobs, submitJob } from '../index.js'
import type { JobRecord } from '../index.js'
import { readState } from './index.js'
import {
  advanceStepOnJobSuccessAssumingLock,
  jumpToPipelineStepAssumingLock,
  withTaskLock,
} from './state.js'

export interface RunTaskStepInput {
  runnerId?: string | null
  /** Step đích khi nhảy/chuỗi (run-step với target). */
  targetStepId?: string | null
  skipIntermediate?: boolean
}

export type RunTaskStepResult =
  | { ok: true; job: JobRecord; stepId: string; skipIntermediate: boolean }
  | { ok: false; status: number; error: string; extra?: Record<string, unknown> }

export async function runTaskStep(
  root: string,
  projectId: string | null,
  taskId: string,
  input: RunTaskStepInput,
): Promise<RunTaskStepResult> {
  // Everything below reads-checks-writes task state and, on success, creates
  // the step's job. Serialize per task: without this, two concurrent callers
  // can both observe "no job running", each move current_phase, and both
  // submit a job — running a step twice or tagging a job with a
  // pipelineStepId that no longer matches the final cursor.
  return withTaskLock(root, taskId, async () => {
    const stateFile = joinPath(root, '.dev-state', `${taskId}.json`)
    let read = await readState(stateFile)
    if (!read.ok) return { ok: false, status: 404, error: 'task not found', extra: { taskId } }
    let state = read.state as Record<string, unknown>
    if (state.hitl_pending) {
      return { ok: false, status: 400, error: 'task is waiting for HITL approval', extra: { taskId } }
    }

    const existing = listJobs(50).find(
      (j) =>
        j.metadata?.taskId === taskId &&
        (j.status === 'queued' || j.status === 'running'),
    )
    if (existing) {
      return { ok: false, status: 409, error: 'step already running', extra: { taskId, job: existing } }
    }

    let stepId = String(state.current_phase ?? '')
    const lastSucceeded = listJobs(200).find(
      (j) =>
        j.metadata?.taskId === taskId &&
        j.status === 'succeeded' &&
        !j.applyTarget &&
        j.metadata?.pipelineStepId === stepId,
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
    // Chain: no skip requested, but a target ahead of the start step — the
    // job queue auto-advances toward it and stops once reached (jobQueue.ts
    // `advancePipelineStepChain`). Validate it same as a jump target so an
    // out-of-pipeline/past id can't be recorded as `chainTarget` and let the
    // chain run past where the caller meant to stop.
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

    // Resolve the step that will actually run BEFORE mutating current_phase
    // (jump), so a missing agent / request.md aborts without moving the
    // cursor to a step nothing then executes for.
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

    if (skip && target) {
      const jumped = await jumpToPipelineStepAssumingLock(stateFile, target)
      if ('error' in jumped) {
        return { ok: false, status: jumped.status, error: jumped.error, extra: { taskId } }
      }
      state = jumped.state
      stepId = target
    }

    const job = submitJob({
      runnerId: input.runnerId ?? undefined,
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
      },
    })

    return { ok: true, job, stepId, skipIntermediate: skip }
  })
}
