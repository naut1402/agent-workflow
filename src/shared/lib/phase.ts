// Phase-status derivation — pure logic pulled out of the fetch layer so it can
// be unit-tested without a server. Mirrors the orchestrator's rule that phase
// status is INFERRED from artifact existence, layered with the live cursor.

export interface Phase {
  key: string
  label: string
  artifact: string | null
  hitl: string | null
}

export type PhaseStatus = 'waiting' | 'active' | 'done' | 'pending'

// Fallback pipeline shape used only when a task has no resolved config (e.g.
// fetch error). Normally phases come from the per-task pipeline config embedded
// in /api/tasks (see phasesFromPipeline). Order = left→right flow; `hitl` is the
// gate that follows the phase.
export const PHASES: Phase[] = [
  { key: 'investigator', label: 'Investigate', artifact: 'investigate.md', hitl: 'hitl-1' },
  { key: 'designer', label: 'Design', artifact: 'design.md', hitl: 'hitl-2' },
  { key: 'implementer', label: 'Implement', artifact: 'phpstan.md', hitl: null },
  { key: 'reviewer', label: 'Review', artifact: 'review.md', hitl: 'hitl-3' },
  { key: 'pr-creator', label: 'PR', artifact: 'pr-desc.md', hitl: null },
]

// Map a resolved pipeline config (steps[]) onto the UI phase shape. `artifact`
// is the first produced file (used to infer "done"); `hitl` is the gate id that
// follows the step, if any.
export function phasesFromPipeline(pipeline: any): Phase[] {
  const steps = pipeline?.steps
  if (!Array.isArray(steps) || !steps.length) return PHASES
  return steps.map((s: any) => ({
    key: s.id,
    label: s.name || s.id,
    artifact: (s.produces && s.produces[0]) || null,
    hitl: s.hitl?.gate_id ?? null,
  }))
}

// Derive a display status for a phase from artifacts + live state.
// When `phaseKeys` is provided, phases already behind the pipeline cursor
// (or a completed pipeline) count as `done` even without an artifact file —
// gate-less steps that never declare `produces` still show as finished.
export function phaseStatus(phase: Phase, task: any, phaseKeys?: string[]): PhaseStatus {
  const artifactDone = phase.artifact ? task.artifacts?.[phase.artifact]?.exists : false
  const isWaiting = phase.hitl && task.hitl_pending === phase.hitl
  const isActive = task.current_phase === phase.key && !task.hitl_pending
  if (isWaiting) return 'waiting'
  if (isActive) return 'active'
  if (artifactDone) return 'done'
  const keys = phaseKeys?.length ? phaseKeys : null
  if (keys) {
    if (task.current_phase === 'completed') return 'done'
    const i = keys.indexOf(phase.key)
    const c = keys.indexOf(String(task.current_phase ?? ''))
    if (i >= 0 && c > i) return 'done'
  }
  return 'pending'
}

export interface PipelineStepLike {
  id?: string
  hitl?: { gate_id?: string } | null
}

/**
 * The gate that is ACTUALLY blocking a task, judged against the pipeline it
 * runs under *right now*.
 *
 * A gate only means something while the `current_phase` cursor still sits on
 * the step declaring it — that is exactly the condition `applyHitlAction`
 * enforces before letting anyone approve (state.ts). Sharing one function
 * between the server (block/clear) and the `/api/tasks` projection (what the UI
 * draws) is the only way "is blocked" and "has a node to approve" can never
 * drift apart again.
 *
 * Returns the gate id that should stay pending (normalising the legacy boolean
 * `true` to the current step's gate id), or null when nothing blocks.
 */
export function resolveHitlPending(
  steps: Array<PipelineStepLike | null> | null | undefined,
  currentPhase: unknown,
  hitlPending: unknown,
): string | null {
  if (!hitlPending) return null // null | false | '' → not blocked
  const pendingId = typeof hitlPending === 'string' ? hitlPending : null

  // Cursor first: with no valid cursor (or a finished pipeline) there is no
  // step that could be holding a gate, no matter what the pipeline says. This
  // has to precede the unreadable check below, or `repairTaskState` — the
  // manual way out — would keep a stale gate on an already-completed task.
  const phase = typeof currentPhase === 'string' ? currentPhase : ''
  if (!phase || phase === 'completed') return null

  // Pipeline unreadable/empty: not enough evidence to conclude the gate is
  // gone, so keep blocking rather than risk releasing a real gate. Callers that
  // loaded a config flagged `untrusted` pass `null` here to land on this
  // branch. Legacy `true` maps to no id, so it has to become null — the UI
  // cannot draw it either, and keeping it only recreates the deadlock this fixes.
  if (!Array.isArray(steps) || steps.length === 0) return pendingId

  const step = steps.find((s) => s && s.id === phase)
  const gateId = step?.hitl?.gate_id
  if (typeof gateId !== 'string' || !gateId) return null // current step has no gate anymore

  // Legacy `true` means "waiting on the current step's gate" — normalise it to
  // the id so the UI's `=== phase.hitl` comparison matches and the approve
  // button appears.
  return hitlPending === true || hitlPending === gateId ? gateId : null
}

/**
 * Steps to judge a pending gate against, given a resolved pipeline config
 * (`loadPipelineConfig`). An `untrusted` config — its YAML is present but does
 * not parse — carries fallback steps that are NOT the task's real shape, so it
 * yields null and `resolveHitlPending` takes its "not enough evidence" branch
 * instead of reading a gate as removed.
 */
export function gateStepsFromConfig(cfg: any): Array<PipelineStepLike | null> | null {
  if (!cfg || cfg.untrusted) return null
  return Array.isArray(cfg.steps) ? cfg.steps : null
}
