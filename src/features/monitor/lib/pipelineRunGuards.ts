/**
 * Pure guards for "click a pipeline node to run/chain".
 * Kept out of PipelineView so unit tests don't need VueFlow.
 */

/** True when the task state file is readable enough to drive a run. */
export function canRunWithTaskState(task: { state_ok?: boolean } | null | undefined): boolean {
  return task?.state_ok !== false
}

/**
 * True when the task needs a state repair: unreadable state file, or
 * `current_phase` points at a step that is no longer in the pipeline
 * (common after a pipeline edit left a finished task stranded).
 */
export function taskNeedsStateRepair(task: {
  state_ok?: boolean
  current_phase?: string | null
  pipeline?: { steps?: Array<{ id?: string } | null> | null } | null
} | null | undefined): boolean {
  if (!task) return false
  if (task.state_ok === false) return true
  const phase = task.current_phase
  if (!phase || phase === 'completed') return false
  const steps = task.pipeline?.steps
  if (!Array.isArray(steps) || steps.length === 0) return false
  return !steps.some((s) => s && s.id === phase)
}

/**
 * True when the task has reached an end state — pipeline finished, or archived.
 * "Merged" is not observable without the GitHub API, so this is the local
 * stand-in used to gate destructive per-task cleanup (worktree removal).
 */
export function isFinishedTaskState(task: {
  current_phase?: string | null
  archived?: boolean
} | null | undefined): boolean {
  if (!task) return false
  return task.current_phase === 'completed' || task.archived === true
}

/**
 * Only the current phase and phases after it may be clicked to run.
 * A past pending/done node must not submit — the server always starts from
 * `current_phase`, so clicking a past id would re-run the current step and
 * look like "I clicked design but implement ran".
 */
export function isRunnableTarget(
  phaseKeys: string[],
  currentPhase: string | null | undefined,
  targetStepId: string,
): boolean {
  if (!phaseKeys.length) return false
  const targetIdx = phaseKeys.indexOf(targetStepId)
  if (targetIdx < 0) return false
  if (!currentPhase) return targetIdx === 0
  const currentIdx = phaseKeys.indexOf(currentPhase)
  if (currentIdx < 0) return false
  return targetIdx >= currentIdx
}

/**
 * Only a phase at or before the current phase may be reset — the reverse
 * direction of `isRunnableTarget`. Kept as a separate function (not a
 * `direction` flag on `isRunnableTarget`) because the two guards protect
 * opposite invariants: Run must never go backwards, Reset must never go
 * forwards past what has actually run.
 */
export function isResettableTarget(
  phaseKeys: string[],
  currentPhase: string | null | undefined,
  targetStepId: string,
): boolean {
  if (!phaseKeys.length) return false
  const targetIdx = phaseKeys.indexOf(targetStepId)
  if (targetIdx < 0) return false
  if (currentPhase === 'completed') return true
  const currentIdx = phaseKeys.indexOf(String(currentPhase ?? ''))
  if (currentIdx < 0) return false
  return targetIdx <= currentIdx
}
