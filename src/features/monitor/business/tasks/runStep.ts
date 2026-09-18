/**
 * Core của "chạy task có sẵn" — tách từ MonitorController.runTaskStep để
 * automations tái sử dụng đúng một đường: serialise per-task (withTaskLock),
 * chặn HITL pending, chặn job đang chạy (409), auto-advance qua step đã
 * succeeded, rồi submit job bước hiện tại.
 *
 * Trả kết quả thuần (không biết HTTP) — controller map sang response.
 */

import { dirname, joinPath, readTextFile } from '../../../../backend/lib/fileHelper.js'
import { isRunnableTarget } from '../../lib/pipelineRunGuards.js'
import { loadPipelineConfig } from '../peers.js'
import { listJobs, submitJob } from '../index.js'
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
  /**
   * Prompt thay cho `request.md` thô. Orchestrator dùng để cấp *brief* (request
   * + tóm tắt bước trước + knowledge). `request.md` vẫn phải tồn tại: thiếu nó
   * là dấu hiệu task hỏng, không phải lý do chạy với prompt rỗng.
   */
  userPrompt?: string
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
  // Guard ngoài `withTaskLock`: nó đọc state của chính task này, và mọi thứ
  // bên trong khoá phải không được chờ một lượt khoá mới của cùng file.
  const startCheck = await assertStartAllowed(root, taskId, input.origin ?? 'manual')
  if ('error' in startCheck) {
    return { ok: false, status: startCheck.status, error: startCheck.error, extra: { taskId } }
  }

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

    // Checked before reconcile so a doomed request leaves no trace (reconcile
    // persists, and touching `state_mtime` would break an open HITL modal's
    // 409 check). Scoped to this project's root: another project's job with
    // the same task id must not make this one look busy. An orchestrator
    // "thinking" job isn't a step run — counting it as busy would block the
    // next step just from chatting with the orchestrator node.
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

    // A gate the current pipeline no longer declares would otherwise deadlock
    // (no node to approve it, `applyHitlAction` refuses) — clear it here, which
    // also heals already-stuck tasks. Must persist, not just patch in memory:
    // `jumpToPipelineStepAssumingLock` re-reads the file and blocks on
    // `hitl_pending` too, so this has to run before the check below.
    const reconciled = await reconcileGateStateAssumingLock(root, taskId, stateFile, { state })
    if (reconciled) state = reconciled.state

    if (state.hitl_pending) {
      return { ok: false, status: 400, error: 'task is waiting for HITL approval', extra: { taskId } }
    }

    let stepId = String(state.current_phase ?? '')

    // Caller đã chỉ đúng step phải chạy (orchestrator dispatch): khối tự-chữa
    // bên dưới phải tắt, nếu không nó auto-advance qua step `review_retry` vừa
    // lùi về, dựa trên job `succeeded` cũ từ trước lần reset.
    const pinned = input.origin === 'orchestrator' && !!input.targetStepId

    // A restart sets `last_reset_at` (state.ts::resetPipelineStepAssumingLock) — a
    // `succeeded` job for this step that finished BEFORE that reset is the run being
    // reset away from, not a signal to auto-advance past the step just reset. Absent
    // `last_reset_at` (never reset), behavior is unchanged: any succeeded job heals
    // a stuck phase.
    const resetAt = typeof state.last_reset_at === 'string' ? state.last_reset_at : null
    // Same project scoping as the `existing` lookup above — a succeeded job for
    // a same-named task in another project must not advance this task's cursor.
    const lastSucceeded = pinned ? undefined : listJobs(200).find(
      (j) =>
        j.metadata?.taskId === taskId &&
        (!j.metadata?.devTeamRoot || j.metadata.devTeamRoot === root) &&
        j.status === 'succeeded' &&
        !j.applyTarget &&
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
    // Chain: no skip requested, but a target ahead of the start step — the
    // job queue auto-advances toward it and stops once reached (jobQueue.ts
    // `advancePipelineStepChain`). Validate it same as a jump target so an
    // out-of-pipeline/past id can't be recorded as `chainTarget` and let the
    // chain run past where the caller meant to stop.
    const chainTarget = !skip && !!target && target !== stepId

    // Lượt pin của orchestrator đi vào đây khi step đích khác `current_phase`:
    // `isRunnableTarget` chỉ cho tiến, nên một `start <stepId>` trỏ về phía sau
    // bị từ chối 400 → `dispatchStep` halt kèm lý do. Đó là hành vi đúng: brief
    // đã soạn cho step đích, chạy một step khác là nói dối cả hai bên.
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
        // Vé đi qua lớp chặn đồng bộ của `submitJob` — chỉ dispatch của
        // orchestrator mới được mang.
        ...(input.origin === 'orchestrator' ? { orchestratorDispatch: true } : {}),
      },
    })

    return { ok: true, job, stepId, skipIntermediate: skip }
  })
}
