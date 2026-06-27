type Step = Record<string, any>

/** Merge one step's fields onto a base step (one level deep for `hitl`). */
export function mergeStep(base: Step, patch: Step): Step {
  const out = { ...base, ...patch }
  if (base.hitl || patch.hitl) out.hitl = { ...(base.hitl || {}), ...(patch.hitl || {}) }
  return out
}

/** Per-task patch: override by `id`, append new ids, drop on `remove: true`. */
export function patchSteps(baseSteps: Step[], patch: Step[]): Step[] {
  const out = baseSteps.map((s) => ({ ...s }))
  for (const p of patch) {
    const idx = out.findIndex((s) => s.id === p.id)
    if (p.remove) {
      if (idx >= 0) out.splice(idx, 1)
      continue
    }
    if (idx >= 0) out[idx] = mergeStep(out[idx], p)
    else out.push(p)
  }
  return out
}

/**
 * Editor saves a full per-task pipeline (steps_replace: true). Hand-written
 * overrides patch by step.id unless every per-task id is new (disjoint from base).
 */
export function perTaskStepsReplace(baseSteps: Step[], per: any): boolean {
  if (per.steps_replace === true) return true
  if (!Array.isArray(per.steps) || per.steps.length === 0) return false
  const baseIds = new Set(baseSteps.map((s) => s.id))
  return !per.steps.some((s: Step) => s.id && baseIds.has(s.id))
}
