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
export function phaseStatus(phase: Phase, task: any): PhaseStatus {
  const artifactDone = phase.artifact ? task.artifacts?.[phase.artifact]?.exists : false
  const isWaiting = phase.hitl && task.hitl_pending === phase.hitl
  const isActive = task.current_phase === phase.key && !task.hitl_pending
  if (isWaiting) return 'waiting'
  if (isActive) return 'active'
  if (artifactDone) return 'done'
  return 'pending'
}
