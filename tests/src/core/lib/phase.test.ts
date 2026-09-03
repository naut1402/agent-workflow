import { describe, expect, it } from 'vitest'
import {
  gateStepsFromConfig,
  PHASES,
  phasesFromPipeline,
  phaseStatus,
  resolveHitlPending,
  type Phase,
} from '../../../../src/core/lib/phase'
import { qs } from '../../../../src/core/http/client'

describe('phasesFromPipeline', () => {
  it('falls back to PHASES when pipeline has no steps', () => {
    expect(phasesFromPipeline(null)).toBe(PHASES)
    expect(phasesFromPipeline({})).toBe(PHASES)
    expect(phasesFromPipeline({ steps: [] })).toBe(PHASES)
  })

  it('maps steps to the UI phase shape', () => {
    const out = phasesFromPipeline({
      steps: [
        { id: 'investigator', name: 'Investigate', produces: ['investigate.md'], hitl: { gate_id: 'hitl-1' } },
        { id: 'implementer', produces: [] },
      ],
    })
    expect(out).toEqual([
      { key: 'investigator', label: 'Investigate', artifact: 'investigate.md', hitl: 'hitl-1' },
      { key: 'implementer', label: 'implementer', artifact: null, hitl: null },
    ])
  })
})

describe('phaseStatus', () => {
  const phase: Phase = { key: 'designer', label: 'Design', artifact: 'design.md', hitl: 'hitl-2' }
  const keys = ['investigator', 'designer', 'implementer']

  it('waiting when the phase gate is pending', () => {
    expect(phaseStatus(phase, { hitl_pending: 'hitl-2' })).toBe('waiting')
  })
  it('active when current phase and no gate pending', () => {
    expect(phaseStatus(phase, { current_phase: 'designer', hitl_pending: null })).toBe('active')
  })
  it('done when the artifact exists (and not active/waiting)', () => {
    expect(phaseStatus(phase, { artifacts: { 'design.md': { exists: true } } })).toBe('done')
  })
  it('pending otherwise', () => {
    expect(phaseStatus(phase, {})).toBe('pending')
  })
  it('waiting takes precedence over done', () => {
    expect(
      phaseStatus(phase, { hitl_pending: 'hitl-2', artifacts: { 'design.md': { exists: true } } }),
    ).toBe('waiting')
  })
  it('done when phase is behind the cursor even without an artifact', () => {
    const gateLess: Phase = { key: 'investigator', label: 'Investigate', artifact: null, hitl: null }
    expect(
      phaseStatus(gateLess, { current_phase: 'designer', hitl_pending: null, artifacts: {} }, keys),
    ).toBe('done')
  })
  it('done for all phases when pipeline is completed', () => {
    expect(
      phaseStatus(phase, { current_phase: 'completed', artifacts: {} }, keys),
    ).toBe('done')
  })
  it('does not mark done by cursor when current_phase is unknown', () => {
    expect(
      phaseStatus(phase, { current_phase: 'ghost-step', artifacts: {} }, keys),
    ).toBe('pending')
  })
})

describe('qs', () => {
  it('drops null/undefined/empty and url-encodes', () => {
    expect(qs({ a: '1', b: null, c: undefined, d: '', e: 'x y' })).toBe('?a=1&e=x%20y')
    expect(qs(null)).toBe('')
    expect(qs({})).toBe('')
  })
})

// T8e63498c: one rule for "which gate is actually blocking?", shared by the
// run-step guard, the /api/tasks projection and repairTaskState. The table
// below is the cheapest safety net for the two invariants that matter: never
// walk past a live gate, and never block without something to approve.
describe('resolveHitlPending', () => {
  const gated = [
    { id: 'fetch' },
    { id: 'designer', hitl: { gate_id: 'g1' } },
    { id: 'implementer' },
    { id: 'reviewer' },
  ]
  const nogate = [{ id: 'fetch' }, { id: 'designer' }, { id: 'implementer' }, { id: 'reviewer' }]

  it('keeps a gate the current step still declares', () => {
    expect(resolveHitlPending(gated, 'designer', 'g1')).toBe('g1')
  })

  it('clears a gate the current step no longer declares (the reported bug)', () => {
    expect(resolveHitlPending(nogate, 'designer', 'g1')).toBeNull()
  })

  it('clears a gate that moved to another step — the cursor is what counts', () => {
    const moved = [
      { id: 'fetch' },
      { id: 'designer' },
      { id: 'implementer', hitl: { gate_id: 'g1' } },
      { id: 'reviewer' },
    ]
    // `g1` still exists in the pipeline, but not where the cursor sits: keeping
    // it would block with the approve node drawn on the wrong step.
    expect(resolveHitlPending(moved, 'designer', 'g1')).toBeNull()
  })

  it('clears a pending id when the gate at the current step was renamed', () => {
    const renamed = [{ id: 'designer', hitl: { gate_id: 'g2' } }]
    expect(resolveHitlPending(renamed, 'designer', 'g1')).toBeNull()
  })

  it('clears when current_phase is not in the pipeline at all', () => {
    expect(resolveHitlPending(gated, 'ghost-step', 'g1')).toBeNull()
  })

  it('normalises legacy boolean true to the current step gate id', () => {
    expect(resolveHitlPending(gated, 'designer', true)).toBe('g1')
  })

  it('clears legacy boolean true when the current step has no gate', () => {
    expect(resolveHitlPending(nogate, 'designer', true)).toBeNull()
  })

  it('returns null for every non-blocking pending value', () => {
    expect(resolveHitlPending(gated, 'designer', null)).toBeNull()
    expect(resolveHitlPending(gated, 'designer', undefined)).toBeNull()
    expect(resolveHitlPending(gated, 'designer', false)).toBeNull()
    expect(resolveHitlPending(gated, 'designer', '')).toBeNull()
  })

  it('clears an unusable pending value of the wrong type', () => {
    expect(resolveHitlPending(gated, 'designer', { gate: 'g1' })).toBeNull()
    expect(resolveHitlPending(gated, 'designer', 42)).toBeNull()
  })

  it('clears once the pipeline is completed or the cursor is empty', () => {
    expect(resolveHitlPending(gated, 'completed', 'g1')).toBeNull()
    expect(resolveHitlPending(gated, '', 'g1')).toBeNull()
    expect(resolveHitlPending(gated, null, 'g1')).toBeNull()
  })

  it('keeps blocking when the pipeline is unreadable — no evidence the gate is gone', () => {
    // Empty/absent steps means "could not resolve the pipeline", not "no gates
    // exist". Releasing a real gate here would be the dangerous direction.
    expect(resolveHitlPending([], 'designer', 'g1')).toBe('g1')
    expect(resolveHitlPending(null, 'designer', 'g1')).toBe('g1')
    expect(resolveHitlPending(undefined, 'designer', 'g1')).toBe('g1')
  })

  it('does not throw on holes in the step list', () => {
    expect(resolveHitlPending([null, { id: 'designer', hitl: null }], 'designer', 'g1')).toBeNull()
  })

  it('a finished pipeline outranks an unreadable one — Repair must not be defanged', () => {
    // Both guards apply at once here. The cursor check has to win: repairing a
    // task whose global pipeline declares `steps: []` is the manual way out of
    // a stuck gate, and holding the gate "for safety" would remove that way out
    // for a task that is already completed.
    expect(resolveHitlPending([], 'completed', 'g1')).toBeNull()
    expect(resolveHitlPending(null, 'completed', 'g1')).toBeNull()
    expect(resolveHitlPending([], '', 'g1')).toBeNull()
  })
})

describe('gateStepsFromConfig', () => {
  const cfg = (extra: Record<string, unknown>) => ({ steps: [{ id: 'designer' }], ...extra })

  it('hands back the steps of a config that was resolved normally', () => {
    expect(gateStepsFromConfig(cfg({ source: 'global' }))).toEqual([{ id: 'designer' }])
  })

  it('hides the steps of an untrusted config so a gate is never read as removed', () => {
    // `untrusted` = a pipeline.yaml exists but does not parse, so `steps` is the
    // builtin/global fallback rather than this task's real shape. Null routes
    // `resolveHitlPending` to its "no evidence" branch.
    expect(gateStepsFromConfig(cfg({ untrusted: true }))).toBeNull()
    expect(resolveHitlPending(gateStepsFromConfig(cfg({ untrusted: true })), 'designer', 'g1')).toBe('g1')
  })

  it('treats a missing or step-less config as unresolved too', () => {
    expect(gateStepsFromConfig(null)).toBeNull()
    expect(gateStepsFromConfig({})).toBeNull()
    expect(gateStepsFromConfig({ steps: 'nope' })).toBeNull()
  })
})
