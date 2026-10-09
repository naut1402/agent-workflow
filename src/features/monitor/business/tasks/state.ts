import {
  dirname,
  joinPath,
  mkdir,
  randomBytes,
  readTextFile,
  rename,
  rm,
  stat,
  writeFile,
  writeTextFile,
} from '../../../../backend/lib/fileHelper.js'
import { resolveHitlPending, gateStepsFromConfig } from '../../../../shared/lib/phase.js'
import { TaskArchivePatch, TaskNamePatch, TaskOrchestratorPatch, TaskStatePatch } from '../../schemas/task.js'
import { loadPipelineConfig } from '../peers.js'
import { readState, flowProfilePath } from './index.js'
import { checkReviewRetry } from './reviewVerdict.js'
import { emit } from '../../../../backend/events/index.js'

export type HitlApplyResult =
  | { ok: true; state: Record<string, unknown>; mtime: number }
  | { ok: false; error: string; status: number; state?: Record<string, unknown>; mtime?: number }

const stateFileChains = new Map<string, Promise<unknown>>()

function withStateFileLock<T>(stateFile: string, fn: () => Promise<T>): Promise<T> {
  const prev = stateFileChains.get(stateFile) ?? Promise.resolve()
  const run = prev.catch(() => {}).then(fn)
  stateFileChains.set(stateFile, run.catch(() => {}))
  return run
}

/**
 * Serialize a multi-step operation per task. Callers already inside this lock
 * must use the `AssumingLock` variants — re-entering it for the same file deadlocks.
 */
export function withTaskLock<T>(root: string, taskId: string, fn: () => Promise<T>): Promise<T> {
  return withStateFileLock(joinPath(root, '.dev-state', `${taskId}.json`), fn)
}

function uniqueTempPath(stateFile: string): string {
  const suffix = `${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`
  return `${stateFile}.${suffix}`
}

/** Atomic write: unique temp file + rename. */
export async function writeStateAtomic(
  stateFile: string,
  state: Record<string, unknown>,
): Promise<number> {
  await mkdir(dirname(stateFile), { recursive: true })
  const tmp = uniqueTempPath(stateFile)
  try {
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await rename(tmp, stateFile)
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {})
    throw err
  }
  const s = await stat(stateFile)
  return s.mtimeMs
}

type JumpResult = { ok: true; state: Record<string, unknown> } | { ok: false; error: string; status: number }

/**
 * Jump the cursor to `targetStepId` without running intermediate steps; the
 * caller holds the task lock and has validated the target.
 */
export async function jumpToPipelineStepAssumingLock(
  stateFile: string,
  targetStepId: string,
): Promise<JumpResult> {
  const read = await readState(stateFile)
  if (!read.ok) return { ok: false, error: 'state not found', status: 404 }
  const state = { ...(read.state as Record<string, unknown>) }
  if (state.hitl_pending) {
    return { ok: false, error: 'task is waiting for HITL approval', status: 400 }
  }
  state.current_phase = targetStepId
  await writeStateAtomic(stateFile, state)
  return { ok: true, state }
}

export async function jumpToPipelineStep(
  root: string,
  taskId: string,
  targetStepId: string,
): Promise<JumpResult> {
  const stateFile = joinPath(root, '.dev-state', `${taskId}.json`)
  return withStateFileLock(stateFile, () => jumpToPipelineStepAssumingLock(stateFile, targetStepId))
}

function stepIndex(steps: any[], stepId: string): number {
  return steps.findIndex((s) => s.id === stepId)
}

export type ResetResult =
  | { ok: true; state: Record<string, unknown>; mtime: number; removedSteps: string[] }
  | { ok: false; error: string; status: number }

/** Hai trục phạm vi của một lần reset — xem `schemas/resetStep.ts`. */
export type ResetScopes = {
  resetScope: 'step' | 'onward'
  deleteScope: 'none' | 'step' | 'onward'
}

/**
 * Roll `current_phase` back to `stepId`; `scopes` picks the steps counted as
 * un-run and whose artifacts get deleted. Caller must already hold the task lock.
 * xem docs/architecture/code/monitor.md §10
 */
export async function resetPipelineStepAssumingLock(
  root: string,
  taskId: string,
  stateFile: string,
  stepId: string,
  scopes: ResetScopes,
): Promise<ResetResult> {
  const read = await readState(stateFile)
  if (!read.ok) return { ok: false, error: 'state not found', status: 404 }
  const state = { ...(read.state as Record<string, unknown>) }

  const pipeline = await loadPipelineConfig(root, taskId)
  const steps = pipeline.steps || []
  const phaseKeys = steps.map((s: any) => s.id).filter(Boolean)
  const targetIdx = phaseKeys.indexOf(stepId)
  if (targetIdx < 0) return { ok: false, error: 'invalid stepId', status: 400 }

  // xem docs/architecture/code/monitor.md §10
  const removedSteps = scopes.resetScope === 'onward' ? phaseKeys.slice(targetIdx) : [stepId]
  const deletedSteps =
    scopes.deleteScope === 'none'
      ? []
      : scopes.deleteScope === 'onward'
        ? phaseKeys.slice(targetIdx)
        : [stepId]

  for (const sid of deletedSteps) {
    const step = steps.find((s: any) => s.id === sid)
    for (const file of step?.produces ?? []) {
      await rm(joinPath(root, 'tasks', taskId, file), { force: true })
      const m = /^(.*)\.md$/.exec(file)
      if (m) await rm(joinPath(root, 'tasks', taskId, `${m[1]}-po.md`), { force: true })
    }
  }

  state.last_reset_at = new Date().toISOString()
  state.current_phase = stepId
  state.hitl_pending = null

  const retryStep = steps.find((s: any) => s.hitl?.retry)
  if (retryStep) {
    const retryIdx = phaseKeys.indexOf(retryStep.id)
    if (targetIdx <= retryIdx) state.review_round = 0
  }
  const docReviewRound = {
    investigate: 0,
    design: 0,
    ...((state.doc_review_round as Record<string, unknown>) ?? {}),
  }
  if (removedSteps.includes('investigator')) docReviewRound.investigate = 0
  if (removedSteps.includes('designer')) docReviewRound.design = 0
  state.doc_review_round = docReviewRound

  const mtime = await writeStateAtomic(stateFile, state)
  emit('task.advanced', {
    taskId,
    stepId,
    currentPhase: state.current_phase,
    reason: 'reset',
    resetScope: scopes.resetScope,
    deleteScope: scopes.deleteScope,
    removedSteps,
  })

  return { ok: true, state, mtime, removedSteps }
}

export async function resetPipelineStep(
  root: string,
  taskId: string,
  stepId: string,
  scopes: ResetScopes,
): Promise<ResetResult> {
  const stateFile = joinPath(root, '.dev-state', `${taskId}.json`)
  return withStateFileLock(stateFile, () =>
    resetPipelineStepAssumingLock(root, taskId, stateFile, stepId, scopes),
  )
}

function hitlPendingMatches(hitlPending: unknown, gateId: string): boolean {
  return hitlPending === true || hitlPending === gateId
}

/**
 * Apply HITL approve/reject to orchestrator state.
 * Approve: clear hitl_pending, advance current_phase to next step (or completed).
 * Reject: clear hitl_pending, keep current_phase, record last_feedback.
 */
export async function applyHitlAction(
  root: string,
  taskId: string,
  patch: TaskStatePatch,
  projectId = '',
): Promise<HitlApplyResult> {
  const stateFile = joinPath(root, '.dev-state', `${taskId}.json`)

  return withStateFileLock(stateFile, async () => {
    const read = await readState(stateFile)
    if (!read.ok) {
      return { ok: false, error: 'state not found', status: 404 }
    }

    let currentMtime: number | null = null
    try {
      const s = await stat(stateFile)
      currentMtime = s.mtimeMs
    } catch {
      currentMtime = null
    }

    if (currentMtime != null && currentMtime !== patch.mtime) {
      return {
        ok: false,
        error: 'conflict',
        status: 409,
        state: read.state,
        mtime: currentMtime,
      }
    }

    const state = { ...read.state } as Record<string, unknown>
    const hitlPending = state.hitl_pending
    if (!hitlPendingMatches(hitlPending, patch.gate_id)) {
      return {
        ok: false,
        error: 'hitl gate mismatch',
        status: 400,
        state,
        mtime: currentMtime ?? undefined,
      }
    }

    const pipeline = await loadPipelineConfig(root, taskId)
    const steps = pipeline.steps || []
    const currentPhase = String(state.current_phase ?? '')
    const stepIdx = stepIndex(steps, currentPhase)
    const currentStep = stepIdx >= 0 ? steps[stepIdx] : null
    const gateId = currentStep?.hitl?.gate_id
    if (!gateId || gateId !== patch.gate_id) {
      return {
        ok: false,
        error: 'gate not active for current phase',
        status: 400,
        state,
        mtime: currentMtime ?? undefined,
      }
    }

    if (patch.action === 'reject') {
      state.hitl_pending = null
      if (patch.feedback?.trim()) {
        state.last_feedback = patch.feedback.trim()
        const feedbackPath = joinPath(root, 'tasks', taskId, 'hitl-feedback.md')
        await mkdir(dirname(feedbackPath), { recursive: true })
        const stamp = new Date().toISOString()
        const block = `\n## ${stamp} — ${patch.gate_id}\n${patch.feedback.trim()}\n`
        try {
          const prev = await readTextFile(feedbackPath)
          await writeTextFile(feedbackPath, prev + block)
        } catch {
          await writeTextFile(feedbackPath, `# HITL feedback — ${taskId}\n${block}`)
        }
      }
    } else {
      state.hitl_pending = null
      const next = steps[stepIdx + 1]
      state.current_phase = next ? next.id : 'completed'
      state.dashboard_approved_at = new Date().toISOString()
    }

    const mtime = await writeStateAtomic(stateFile, state)
    emit('hitl.resolved', {
      taskId,
      gateId: patch.gate_id,
      action: patch.action,
      currentPhase: state.current_phase,
      stepId: currentStep.id,
      projectId: projectId || undefined,
      devTeamRoot: root,
    })

    // xem docs/architecture/code/monitor.md §9
    const orchestratorActive =
      pipeline?.orchestrator?.enabled === true && state.orchestrator_halted !== true

    if (patch.action === 'reject' && patch.feedback?.trim() && currentStep && !orchestratorActive) {
      // xem docs/architecture/code/monitor.md §9
      const feedback = patch.feedback.trim()
      const stepId = currentStep.id
      void import('../index.js')
        .then(({ sendTaskFeedback }) =>
          sendTaskFeedback(taskId, projectId, feedback, { stepId, source: 'gate' }),
        )
        .catch(() => {
          // Best-effort: the reject is already persisted.
        })
    }

    return { ok: true, state, mtime }
  })
}

/**
 * Bring `hitl_pending` back in line with the current pipeline; writes and emits
 * only when the value changes, returns null otherwise. Caller must already hold
 * the task lock.
 * xem docs/architecture/code/monitor.md §8
 */
export async function reconcileGateStateAssumingLock(
  root: string,
  taskId: string,
  stateFile: string,
  preloaded?: { state?: Record<string, unknown>; pipeline?: any },
): Promise<{
  state: Record<string, unknown>
  mtime: number
  from: unknown
  to: string | null
} | null> {
  let raw = preloaded?.state
  if (!raw) {
    const read = await readState(stateFile)
    if (!read.ok) return null
    raw = read.state as Record<string, unknown>
  }

  const state = { ...raw }
  const before = state.hitl_pending
  if (!before) return null

  const pipeline = preloaded?.pipeline ?? (await loadPipelineConfig(root, taskId))
  // xem docs/architecture/code/monitor.md §8
  const after = resolveHitlPending(gateStepsFromConfig(pipeline), state.current_phase, before)
  if (after === before) return null

  state.hitl_pending = after
  state.gate_reconciled_at = new Date().toISOString()
  const mtime = await writeStateAtomic(stateFile, state)

  emit('hitl.resolved', {
    taskId,
    gateId: typeof before === 'string' ? before : null,
    action: after ? 'normalized' : 'cancelled',
    reason: 'pipeline_changed',
    currentPhase: state.current_phase,
    devTeamRoot: root,
  })
  return { state, mtime, from: before, to: after }
}

export async function reconcileGateState(root: string, taskId: string) {
  const stateFile = joinPath(root, '.dev-state', `${taskId}.json`)
  return withStateFileLock(stateFile, () =>
    reconcileGateStateAssumingLock(root, taskId, stateFile),
  )
}

/**
 * Advance task state after a dashboard-run step job succeeds; returns null
 * (nothing to do) when `current_phase` no longer matches `stepId` or a gate is
 * pending. Caller must already hold the task lock.
 */
export async function advanceStepOnJobSuccessAssumingLock(
  root: string,
  taskId: string,
  stepId: string,
  stateFile: string,
): Promise<{ state: Record<string, unknown>; mtime: number } | null> {
  const read = await readState(stateFile)
  if (!read.ok) return null
  const pipeline = await loadPipelineConfig(root, taskId)
  const reconciled = await reconcileGateStateAssumingLock(root, taskId, stateFile, {
    state: read.state as Record<string, unknown>,
    pipeline,
  })

  const state = { ...(reconciled?.state ?? (read.state as Record<string, unknown>)) }
  if (String(state.current_phase ?? '') !== stepId) return null
  if (state.hitl_pending) return null

  const steps = pipeline.steps || []
  const stepIdx = stepIndex(steps, stepId)
  const currentStep = stepIdx >= 0 ? steps[stepIdx] : null
  if (!currentStep) return null

  const retry = currentStep.hitl?.retry
  const restartStepExists = retry ? steps.some((s: any) => s.id === retry.restart_from) : false
  if (retry && restartStepExists) {
    const verdict = await checkReviewRetry(root, taskId, currentStep)
    if (verdict.retry) {
      const round = Number(state.review_round ?? 0) + 1
      state.review_round = round
      if (round <= retry.max) {
        state.current_phase = retry.restart_from
        state.hitl_pending = null
        const mtime = await writeStateAtomic(stateFile, state)
        emit('task.advanced', {
          taskId,
          stepId,
          currentPhase: state.current_phase,
          reason: 'review_retry',
          devTeamRoot: root,
        })
        return { state, mtime }
      }
    }
  }

  const gateId = currentStep.hitl?.gate_id
  if (gateId && !state.auto_review) {
    state.hitl_pending = gateId
  } else {
    const next = steps[stepIdx + 1]
    state.current_phase = next ? next.id : 'completed'
  }

  const mtime = await writeStateAtomic(stateFile, state)
  if (state.hitl_pending) {
    emit('hitl.pending', { taskId, gateId, stepId, devTeamRoot: root })
  } else {
    emit('task.advanced', { taskId, stepId, currentPhase: state.current_phase, devTeamRoot: root })
  }
  return { state, mtime }
}

export async function advanceStepOnJobSuccess(
  root: string,
  taskId: string,
  stepId: string,
): Promise<{ state: Record<string, unknown>; mtime: number } | null> {
  const stateFile = joinPath(root, '.dev-state', `${taskId}.json`)

  return withStateFileLock(stateFile, async () => {
    const read = await readState(stateFile)
    if (!read.ok) return null
    const pipeline = await loadPipelineConfig(root, taskId)
    const reconciled = await reconcileGateStateAssumingLock(root, taskId, stateFile, {
      state: read.state as Record<string, unknown>,
      pipeline,
    })

    const state = { ...(reconciled?.state ?? (read.state as Record<string, unknown>)) }
    if (String(state.current_phase ?? '') !== stepId) return null
    if (state.hitl_pending) return null

    const steps = pipeline.steps || []
    const stepIdx = stepIndex(steps, stepId)
    const currentStep = stepIdx >= 0 ? steps[stepIdx] : null
    if (!currentStep) return null

    const retry = currentStep.hitl?.retry
    const restartStepExists = retry ? steps.some((s: any) => s.id === retry.restart_from) : false
    if (retry && restartStepExists) {
      const verdict = await checkReviewRetry(root, taskId, currentStep)
      if (verdict.retry) {
        const round = Number(state.review_round ?? 0) + 1
        state.review_round = round
        if (round <= retry.max) {
          state.current_phase = retry.restart_from
          state.hitl_pending = null
          const mtime = await writeStateAtomic(stateFile, state)
          emit('task.advanced', {
            taskId,
            stepId,
            currentPhase: state.current_phase,
            reason: 'review_retry',
            devTeamRoot: root,
          })
          return { state, mtime }
        }
      }
    }

    const gateId = currentStep.hitl?.gate_id
    if (gateId && !state.auto_review) {
      state.hitl_pending = gateId
    } else {
      const next = steps[stepIdx + 1]
      state.current_phase = next ? next.id : 'completed'
    }

    const mtime = await writeStateAtomic(stateFile, state)
    if (state.hitl_pending) {
      emit('hitl.pending', { taskId, gateId, stepId, devTeamRoot: root })
    } else {
      emit('task.advanced', { taskId, stepId, currentPhase: state.current_phase, devTeamRoot: root })
    }
    return { state, mtime }
  })
}

export interface PendingFeedback {
  feedback: string
  stepId?: string
  /** Ai xếp hàng phản hồi này; mục `gate` không tự gửi khi orchestrator đang điều phối. */
  source?: 'chat' | 'gate' | 'orchestrator'
}

/**
 * Record feedback for a step whose job is still running; `runJob` resubmits it
 * once the job finishes. Only the latest feedback per task is kept. Returns
 * `false` (writes nothing) when the task has no `.dev-state` file.
 */
export async function queuePendingFeedback(
  root: string,
  taskId: string,
  feedback: PendingFeedback,
): Promise<boolean> {
  const stateFile = joinPath(root, '.dev-state', `${taskId}.json`)
  return withStateFileLock(stateFile, async () => {
    const read = await readState(stateFile)
    if (!read.ok) return false
    const state = { ...read.state, pending_feedback: feedback } as Record<string, unknown>
    await writeStateAtomic(stateFile, state)
    return true
  })
}

/** Consume (and clear) a task's queued feedback, if any — null if none is pending. */
export async function takePendingFeedback(root: string, taskId: string): Promise<PendingFeedback | null> {
  const stateFile = joinPath(root, '.dev-state', `${taskId}.json`)
  return withStateFileLock(stateFile, async () => {
    const read = await readState(stateFile)
    if (!read.ok) return null
    const pending = read.state.pending_feedback as PendingFeedback | undefined
    if (!pending) return null
    const state = { ...read.state, pending_feedback: null } as Record<string, unknown>
    await writeStateAtomic(stateFile, state)
    return pending
  })
}

/** Archive/unarchive a task, whatever its `current_phase`; no gate validation. */
export async function applyArchiveAction(
  root: string,
  taskId: string,
  patch: TaskArchivePatch,
): Promise<HitlApplyResult> {
  const stateFile = joinPath(root, '.dev-state', `${taskId}.json`)

  return withStateFileLock(stateFile, async () => {
    const read = await readState(stateFile)
    if (!read.ok) {
      return { ok: false, error: 'state not found', status: 404 }
    }

    let currentMtime: number | null = null
    try {
      const s = await stat(stateFile)
      currentMtime = s.mtimeMs
    } catch {
      currentMtime = null
    }

    if (currentMtime != null && currentMtime !== patch.mtime) {
      return {
        ok: false,
        error: 'conflict',
        status: 409,
        state: read.state,
        mtime: currentMtime,
      }
    }

    const state = { ...read.state } as Record<string, unknown>
    state.archived = patch.archived
    state.archived_at = patch.archived ? new Date().toISOString() : null

    const mtime = await writeStateAtomic(stateFile, state)
    return { ok: true, state, mtime }
  })
}

/** Bấm Stop trên node orchestrator: ghi `orchestrator_halted`, trả quyền start về chế độ tay. */
export async function applyOrchestratorHaltAction(
  root: string,
  taskId: string,
  patch: TaskOrchestratorPatch,
): Promise<HitlApplyResult> {
  const stateFile = joinPath(root, '.dev-state', `${taskId}.json`)

  return withStateFileLock(stateFile, async () => {
    const read = await readState(stateFile)
    if (!read.ok) {
      return { ok: false, error: 'state not found', status: 404 }
    }

    let currentMtime: number | null = null
    try {
      const s = await stat(stateFile)
      currentMtime = s.mtimeMs
    } catch {
      currentMtime = null
    }

    if (currentMtime != null && currentMtime !== patch.mtime) {
      return { ok: false, error: 'conflict', status: 409, state: read.state, mtime: currentMtime }
    }

    const state = { ...read.state } as Record<string, unknown>
    state.orchestrator_halted = patch.halted
    state.orchestrator_halted_at = patch.halted ? new Date().toISOString() : null

    const mtime = await writeStateAtomic(stateFile, state)
    return { ok: true, state, mtime }
  })
}

/** Rename a task. */
export async function applyRenameAction(
  root: string,
  taskId: string,
  patch: TaskNamePatch,
): Promise<HitlApplyResult> {
  const stateFile = joinPath(root, '.dev-state', `${taskId}.json`)

  return withStateFileLock(stateFile, async () => {
    const read = await readState(stateFile)
    if (!read.ok) {
      return { ok: false, error: 'state not found', status: 404 }
    }

    let currentMtime: number | null = null
    try {
      const s = await stat(stateFile)
      currentMtime = s.mtimeMs
    } catch {
      currentMtime = null
    }

    if (currentMtime != null && currentMtime !== patch.mtime) {
      return {
        ok: false,
        error: 'conflict',
        status: 409,
        state: read.state,
        mtime: currentMtime,
      }
    }

    const state = { ...read.state } as Record<string, unknown>
    state.name = patch.name

    const mtime = await writeStateAtomic(stateFile, state)
    return { ok: true, state, mtime }
  })
}

/** Permanently delete a task's files; works even when the state file is missing or corrupt. */
export async function deleteTask(
  root: string,
  taskId: string,
): Promise<{ ok: true }> {
  const stateFile = joinPath(root, '.dev-state', `${taskId}.json`)
  return withStateFileLock(stateFile, async () => {
    await rm(joinPath(root, 'tasks', taskId), { recursive: true, force: true })
    await rm(stateFile, { force: true })
    await rm(flowProfilePath(root, taskId), { force: true })
    return { ok: true }
  })
}

/**
 * Repair a stranded task state so archive/delete/run become usable again:
 * - Missing/corrupt state file → write a minimal `completed` state.
 * - `current_phase` not in the current pipeline (and not `completed`) → set
 *   `completed` (task finished under an older pipeline shape).
 * - Stale `hitl_pending` that the step at `current_phase` no longer declares →
 *   clear it (`resolveHitlPending`).
 */
export async function repairTaskState(
  root: string,
  taskId: string,
): Promise<HitlApplyResult> {
  const stateFile = joinPath(root, '.dev-state', `${taskId}.json`)

  return withStateFileLock(stateFile, async () => {
    const pipeline = await loadPipelineConfig(root, taskId)
    const steps = pipeline.steps || []
    const stepIds = new Set(steps.map((s: any) => s.id).filter(Boolean))

    const read = await readState(stateFile)
    let state: Record<string, unknown>
    if (!read.ok) {
      state = {
        current_phase: 'completed',
        hitl_pending: null,
        archived: false,
        archived_at: null,
        repaired_at: new Date().toISOString(),
      }
    } else {
      state = { ...read.state } as Record<string, unknown>
      const phase = state.current_phase
      if (
        typeof phase !== 'string' ||
        !phase ||
        (phase !== 'completed' && !stepIds.has(phase))
      ) {
        state.current_phase = 'completed'
        state.hitl_pending = null
      }
      // xem docs/architecture/code/monitor.md §8
      const pending = state.hitl_pending
      if (pending != null) {
        state.hitl_pending = resolveHitlPending(steps, state.current_phase, pending)
      }
      state.repaired_at = new Date().toISOString()
    }

    const mtime = await writeStateAtomic(stateFile, state)
    return { ok: true, state, mtime }
  })
}
