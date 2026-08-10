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
import { TaskArchivePatch, TaskStatePatch } from '../../schemas/task.js'
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

function stepIndex(steps: any[], stepId: string): number {
  return steps.findIndex((s) => s.id === stepId)
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
    if (gateId) {
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
