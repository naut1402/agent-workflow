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
} from '../../../../core/lib/fileHelper.js'
import { TaskArchivePatch, TaskNamePatch, TaskStatePatch } from '../../schemas/task.js'
import { loadPipelineConfig } from '../peers.js'
import { readState, flowProfilePath } from './index.js'
import { checkReviewRetry } from './reviewVerdict.js'
import { emit } from '../../../../core/events/index.js'

export type HitlApplyResult =
  | { ok: true; state: Record<string, unknown>; mtime: number }
  | { ok: false; error: string; status: number; state?: Record<string, unknown>; mtime?: number }

const stateFileChains = new Map<string, Promise<unknown>>()

/** Serialize read-check-write per state file (single-process MVP). */
function withStateFileLock<T>(stateFile: string, fn: () => Promise<T>): Promise<T> {
  const prev = stateFileChains.get(stateFile) ?? Promise.resolve()
  const run = prev.catch(() => {}).then(fn)
  stateFileChains.set(stateFile, run.catch(() => {}))
  return run
}

/**
 * Serialize an entire multi-step operation (read → validate → write, possibly
 * spanning several state mutations and a job submission) per task. Callers
 * already inside this lock must use the `AssumingLock` function variants below
 * instead of the normal exported ones — re-entering `withStateFileLock` for
 * the same file from within its own callback deadlocks (the outer call never
 * resolves, so the inner call waits forever for its turn).
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

/**
 * Jump the pipeline cursor to `targetStepId` without running intermediate
 * steps. Caller must validate the target is in-pipeline and runnable; does
 * not clear an open HITL gate (run-step rejects those earlier).
 */
type JumpResult = { ok: true; state: Record<string, unknown> } | { ok: false; error: string; status: number }

/** Core of `jumpToPipelineStep` — caller must already hold the task's lock (`withTaskLock`). */
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

/**
 * Roll `current_phase` back to `stepId` and delete its artifacts (and, with
 * `cascade`, every step after it). The reverse of `jumpToPipelineStepAssumingLock`
 * — that one only ever moves the cursor forward (guarded by `isRunnableTarget`);
 * this one moves it backward (guarded by `isResettableTarget`), which is why it's
 * a separate function rather than a shared "jump" with a direction flag.
 *
 * `qa.md`/`hitl-feedback.md` are deliberately left alone — they're task-wide
 * history, not a single step's artifact.
 *
 * Core of `resetPipelineStep` — caller must already hold the task's lock (`withTaskLock`).
 */
export async function resetPipelineStepAssumingLock(
  root: string,
  taskId: string,
  stateFile: string,
  stepId: string,
  cascade: boolean,
): Promise<ResetResult> {
  const read = await readState(stateFile)
  if (!read.ok) return { ok: false, error: 'state not found', status: 404 }
  const state = { ...(read.state as Record<string, unknown>) }

  const pipeline = await loadPipelineConfig(root, taskId)
  const steps = pipeline.steps || []
  const phaseKeys = steps.map((s: any) => s.id).filter(Boolean)
  const targetIdx = phaseKeys.indexOf(stepId)
  if (targetIdx < 0) return { ok: false, error: 'invalid stepId', status: 400 }

  const removedSteps = cascade ? phaseKeys.slice(targetIdx) : [stepId]

  for (const sid of removedSteps) {
    const step = steps.find((s: any) => s.id === sid)
    for (const file of step?.produces ?? []) {
      await rm(joinPath(root, 'tasks', taskId, file), { force: true })
      const m = /^(.*)\.md$/.exec(file)
      if (m) await rm(joinPath(root, 'tasks', taskId, `${m[1]}-po.md`), { force: true })
    }
  }

  // Distinguishes an active reset from the "heal stuck phase" fallback in
  // `runTaskStep` (controller.ts): a `succeeded` job for this step that finished
  // BEFORE this timestamp is stale (belongs to the run being reset away from),
  // not a signal to auto-advance past the freshly reset step.
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
  // No dedicated `task.reset` type — event-catalog.md's convention is that
  // step-cursor changes go through `task.advanced` with a `reason` (same as
  // `review_retry` below), not a new `pipeline.*`/`step.*` type per action.
  emit('task.advanced', {
    taskId,
    stepId,
    currentPhase: state.current_phase,
    reason: 'reset',
    cascade,
    removedSteps,
  })

  return { ok: true, state, mtime, removedSteps }
}

export async function resetPipelineStep(
  root: string,
  taskId: string,
  stepId: string,
  cascade: boolean,
): Promise<ResetResult> {
  const stateFile = joinPath(root, '.dev-state', `${taskId}.json`)
  return withStateFileLock(stateFile, () =>
    resetPipelineStepAssumingLock(root, taskId, stateFile, stepId, cascade),
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
    })

    if (patch.action === 'reject' && patch.feedback?.trim() && currentStep) {
      // `sendTaskFeedback` lives behind the full `../index.js` barrel, which
      // re-exports runner — and runner re-exports this module. Import it lazily
      // so the cycle never runs at module-eval time (that's why the static
      // import above goes through `../peers.js`).
      const feedback = patch.feedback.trim()
      const stepId = currentStep.id
      void import('../index.js')
        .then(({ sendTaskFeedback }) => sendTaskFeedback(taskId, projectId, feedback, { stepId }))
        .catch(() => {
          // Best-effort: reject already persisted OK even if feedback dispatch fails
          // (step "cooled down", job busy, etc).
        })
    }

    return { ok: true, state, mtime }
  })
}

/**
 * Update task state after a dashboard-triggered "run step" job succeeds —
 * fills the bookkeeping gap that only the external orchestrator CLI used to
 * cover:
 * - Gate-less step: advance `current_phase` to the next step (or
 *   `'completed'`) straight away, same as `applyHitlAction`'s approve branch.
 * - Gated step: the artifact is now ready for review, so open the gate
 *   (`hitl_pending = gate_id`) instead of advancing — `current_phase` stays on
 *   this step until the user approves/rejects via `applyHitlAction`, same as
 *   if the orchestrator had run it.
 *
 * No-ops (returns null) if `current_phase` no longer matches `stepId` (raced
 * by another action) or a gate is already pending — callers should treat a
 * null result as "nothing to do", not an error.
 */
/** Core of `advanceStepOnJobSuccess` — caller must already hold the task's lock (`withTaskLock`). */
export async function advanceStepOnJobSuccessAssumingLock(
  root: string,
  taskId: string,
  stepId: string,
  stateFile: string,
): Promise<{ state: Record<string, unknown>; mtime: number } | null> {
  const read = await readState(stateFile)
  if (!read.ok) return null

  const state = { ...read.state } as Record<string, unknown>
  if (String(state.current_phase ?? '') !== stepId) return null
  if (state.hitl_pending) return null

  const pipeline = await loadPipelineConfig(root, taskId)
  const steps = pipeline.steps || []
  const stepIdx = stepIndex(steps, stepId)
  const currentStep = stepIdx >= 0 ? steps[stepIdx] : null
  if (!currentStep) return null

  // A step opting into `hitl.retry` (e.g. `reviewer` in DEFAULT_PIPELINE) gets
  // its artifact's verdict checked BEFORE the gate/advance below — a
  // `NEEDS_CHANGES`-style verdict loops back to `retry.restart_from` without
  // ever bothering the human gate; only an approve verdict (or exhausting
  // `retry.max`) falls through to the existing behavior.
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
        return { state, mtime }
      }
      // Past `retry.max`: fall through to the gate/advance logic below —
      // for a step with `hitl.gate_id` (like `reviewer`), that opens the
      // human gate instead of leaving the task silently re-runnable.
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

    const state = { ...read.state } as Record<string, unknown>
    if (String(state.current_phase ?? '') !== stepId) return null
    if (state.hitl_pending) return null

    const pipeline = await loadPipelineConfig(root, taskId)
    const steps = pipeline.steps || []
    const stepIdx = stepIndex(steps, stepId)
    const currentStep = stepIdx >= 0 ? steps[stepIdx] : null
    if (!currentStep) return null

    // A step opting into `hitl.retry` (e.g. `reviewer` in DEFAULT_PIPELINE) gets
    // its artifact's verdict checked BEFORE the gate/advance below — a
    // `NEEDS_CHANGES`-style verdict loops back to `retry.restart_from` without
    // ever bothering the human gate; only an approve verdict (or exhausting
    // `retry.max`) falls through to the existing behavior.
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
          })
          return { state, mtime }
        }
        // Past `retry.max`: fall through to the gate/advance logic below —
        // for a step with `hitl.gate_id` (like `reviewer`), that opens the
        // human gate instead of leaving the task silently re-runnable.
      }
    }

    const gateId = currentStep.hitl?.gate_id
    if (gateId && !state.auto_review) {
      state.hitl_pending = gateId
    } else {
      const next = steps[stepIdx + 1]
      state.current_phase = next ? next.id : 'completed'
    }

    // Emit after persist so listeners never read stale state.
    const mtime = await writeStateAtomic(stateFile, state)
    if (gateId) {
      emit('hitl.pending', { taskId, gateId, stepId })
    } else {
      emit('task.advanced', { taskId, stepId, currentPhase: state.current_phase })
    }
    return { state, mtime }
  })
}

export interface PendingFeedback {
  feedback: string
  stepId?: string
}

/**
 * Record feedback sent while its target step's job is still `running` —
 * `runJob` collects this once that job finishes and resubmits it via
 * `sendTaskFeedback`. A second call before the job finishes overwrites the
 * first; only the latest feedback for a task is kept (test-spec §3.8).
 *
 * Returns `false` (and writes nothing) when `taskId` has no `.dev-state`
 * file — callers must not report `queued: true` in that case, since nothing
 * will ever resubmit it (e.g. nl-chat's scratch sessions, which reuse this
 * same feedback path but aren't dashboard pipeline tasks).
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

/**
 * Archive/unarchive a task. Separate from `applyHitlAction` on purpose: archiving
 * is not a HITL gate decision, so it doesn't validate `gate_id`/`hitl_pending` —
 * the server accepts archiving any task regardless of `current_phase` (the
 * completed-only restriction is a UI affordance, not a server-side invariant).
 */
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

/** Rename a task. Mirrors applyArchiveAction's lock/mtime-check/write shape. */
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

/**
 * Permanently delete a task's files. Unlike applyArchiveAction, this does NOT
 * require readState() to succeed first — it exists specifically to remove
 * tasks whose state file is missing/corrupt and therefore have no other
 * available action (see B0009 §5).
 */
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
 * - Stale `hitl_pending` that no longer matches any step gate → clear it.
 *
 * Callers that also want "heal stuck phase after a succeeded job" should run
 * `advanceStepOnJobSuccess` first (same pattern as `runTaskStep`).
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
    const gateIds = new Set(
      steps.map((s: any) => s.hitl?.gate_id).filter((g: unknown) => typeof g === 'string' && g),
    )

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
      const pending = state.hitl_pending
      if (pending != null && (typeof pending !== 'string' || !gateIds.has(pending))) {
        state.hitl_pending = null
      }
      state.repaired_at = new Date().toISOString()
    }

    const mtime = await writeStateAtomic(stateFile, state)
    return { ok: true, state, mtime }
  })
}
