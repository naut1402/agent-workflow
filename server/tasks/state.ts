import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { TaskArchivePatch, TaskStatePatch } from '../../shared/schemas/task.js'
import { loadPipelineConfig } from '../pipeline/index.js'
import { readState } from './index.js'

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
  await fs.mkdir(path.dirname(stateFile), { recursive: true })
  const tmp = uniqueTempPath(stateFile)
  try {
    await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await fs.rename(tmp, stateFile)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
  const s = await fs.stat(stateFile)
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
  const stateFile = path.join(root, '.dev-state', `${taskId}.json`)

  return withStateFileLock(stateFile, async () => {
    const read = await readState(stateFile)
    if (!read.ok) {
      return { ok: false, error: 'state not found', status: 404 }
    }

    let currentMtime: number | null = null
    try {
      const s = await fs.stat(stateFile)
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
        const feedbackPath = path.join(root, 'tasks', taskId, 'hitl-feedback.md')
        await fs.mkdir(path.dirname(feedbackPath), { recursive: true })
        const stamp = new Date().toISOString()
        const block = `\n## ${stamp} — ${patch.gate_id}\n${patch.feedback.trim()}\n`
        try {
          const prev = await fs.readFile(feedbackPath, 'utf8')
          await fs.writeFile(feedbackPath, prev + block, 'utf8')
        } catch {
          await fs.writeFile(feedbackPath, `# HITL feedback — ${taskId}\n${block}`, 'utf8')
        }
      }
    } else {
      state.hitl_pending = null
      const next = steps[stepIdx + 1]
      state.current_phase = next ? next.id : 'completed'
      state.dashboard_approved_at = new Date().toISOString()
    }

    const mtime = await writeStateAtomic(stateFile, state)
    return { ok: true, state, mtime }
  })
}

/**
 * Advance `current_phase` to the next step after a dashboard-triggered "run
 * step" job succeeds — but only for a step that has no HITL gate of its own
 * (`hitl` null in the pipeline config). A gated step still requires an
 * explicit approve/reject through `applyHitlAction`; this function only fills
 * the gap for gate-less steps, which nothing else advances today.
 *
 * No-ops (returns null) if `current_phase` no longer matches `stepId` (raced
 * by another action) or the step still has a gate — callers should treat a
 * null result as "nothing to do", not an error.
 */
export async function advanceStepOnJobSuccess(
  root: string,
  taskId: string,
  stepId: string,
): Promise<{ state: Record<string, unknown>; mtime: number } | null> {
  const stateFile = path.join(root, '.dev-state', `${taskId}.json`)

  return withStateFileLock(stateFile, async () => {
    const read = await readState(stateFile)
    if (!read.ok) return null

    const state = { ...read.state } as Record<string, unknown>
    if (String(state.current_phase ?? '') !== stepId) return null

    const pipeline = await loadPipelineConfig(root, taskId)
    const steps = pipeline.steps || []
    const stepIdx = stepIndex(steps, stepId)
    const currentStep = stepIdx >= 0 ? steps[stepIdx] : null
    if (!currentStep || currentStep.hitl?.gate_id) return null

    const next = steps[stepIdx + 1]
    state.current_phase = next ? next.id : 'completed'

    const mtime = await writeStateAtomic(stateFile, state)
    return { state, mtime }
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
  const stateFile = path.join(root, '.dev-state', `${taskId}.json`)

  return withStateFileLock(stateFile, async () => {
    const read = await readState(stateFile)
    if (!read.ok) {
      return { ok: false, error: 'state not found', status: 404 }
    }

    let currentMtime: number | null = null
    try {
      const s = await fs.stat(stateFile)
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
