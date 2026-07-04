import fs from 'node:fs/promises'
import path from 'node:path'
import { TaskStatePatch } from '../../shared/schemas/task.js'
import { loadPipelineConfig } from '../pipeline/index.js'
import { readState } from './index.js'

export type HitlApplyResult =
  | { ok: true; state: Record<string, unknown>; mtime: number }
  | { ok: false; error: string; status: number; state?: Record<string, unknown>; mtime?: number }

/** Atomic write: temp file + rename. */
export async function writeStateAtomic(
  stateFile: string,
  state: Record<string, unknown>,
): Promise<number> {
  await fs.mkdir(path.dirname(stateFile), { recursive: true })
  const tmp = `${stateFile}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, stateFile)
  const s = await fs.stat(stateFile)
  return s.mtimeMs
}

function stepIndex(steps: any[], stepId: string): number {
  return steps.findIndex((s) => s.id === stepId)
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
  expectedMtimeArg?: number,
): Promise<HitlApplyResult> {
  const expectedMtime = expectedMtimeArg ?? patch.mtime
  const stateFile = path.join(root, '.dev-state', `${taskId}.json`)
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

  if (
    typeof expectedMtime === 'number' &&
    currentMtime != null &&
    currentMtime !== expectedMtime
  ) {
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
  if (!hitlPending || hitlPending !== patch.gate_id) {
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
}
