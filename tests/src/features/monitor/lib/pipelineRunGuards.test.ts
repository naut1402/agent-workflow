import { describe, expect, it } from 'vitest'
import {
  canRunWithTaskState,
  isResettableTarget,
  isRunnableTarget,
  taskNeedsStateRepair,
} from '@/features/monitor/lib/pipelineRunGuards'

const KEYS = ['investigator', 'designer', 'implementer', 'reviewer', 'pr-creator']

describe('canRunWithTaskState', () => {
  it('allows run when state_ok is true or omitted', () => {
    expect(canRunWithTaskState({ state_ok: true })).toBe(true)
    expect(canRunWithTaskState({})).toBe(true)
  })

  it('blocks run when state_ok is false', () => {
    expect(canRunWithTaskState({ state_ok: false })).toBe(false)
  })
})

describe('taskNeedsStateRepair', () => {
  it('flags unreadable state', () => {
    expect(taskNeedsStateRepair({ state_ok: false })).toBe(true)
  })

  it('flags current_phase missing from pipeline steps', () => {
    expect(
      taskNeedsStateRepair({
        state_ok: true,
        current_phase: 'ghost-step',
        pipeline: { steps: [{ id: 'implementer' }] },
      }),
    ).toBe(true)
  })

  it('allows completed and in-pipeline phases', () => {
    expect(
      taskNeedsStateRepair({
        state_ok: true,
        current_phase: 'completed',
        pipeline: { steps: [{ id: 'implementer' }] },
      }),
    ).toBe(false)
    expect(
      taskNeedsStateRepair({
        state_ok: true,
        current_phase: 'implementer',
        pipeline: { steps: [{ id: 'implementer' }] },
      }),
    ).toBe(false)
  })
})

describe('isRunnableTarget', () => {
  it('allows the current phase and phases after it', () => {
    expect(isRunnableTarget(KEYS, 'implementer', 'implementer')).toBe(true)
    expect(isRunnableTarget(KEYS, 'implementer', 'reviewer')).toBe(true)
    expect(isRunnableTarget(KEYS, 'implementer', 'pr-creator')).toBe(true)
  })

  it('rejects phases before the current one (would re-run current instead)', () => {
    expect(isRunnableTarget(KEYS, 'implementer', 'designer')).toBe(false)
    expect(isRunnableTarget(KEYS, 'implementer', 'investigator')).toBe(false)
  })

  it('rejects unknown ids', () => {
    expect(isRunnableTarget(KEYS, 'implementer', 'nope')).toBe(false)
    expect(isRunnableTarget(KEYS, 'ghost', 'implementer')).toBe(false)
  })
})

describe('isResettableTarget', () => {
  it('allows the current phase and phases before it', () => {
    expect(isResettableTarget(KEYS, 'reviewer', 'reviewer')).toBe(true)
    expect(isResettableTarget(KEYS, 'reviewer', 'implementer')).toBe(true)
    expect(isResettableTarget(KEYS, 'reviewer', 'investigator')).toBe(true)
  })

  it('rejects phases after the current one (nothing to reset yet)', () => {
    expect(isResettableTarget(KEYS, 'implementer', 'reviewer')).toBe(false)
    expect(isResettableTarget(KEYS, 'implementer', 'pr-creator')).toBe(false)
  })

  it('completed task can reset back to any step in the pipeline', () => {
    for (const k of KEYS) {
      expect(isResettableTarget(KEYS, 'completed', k)).toBe(true)
    }
  })

  it('rejects unknown target ids', () => {
    expect(isResettableTarget(KEYS, 'reviewer', 'nope')).toBe(false)
  })

  it('rejects when phaseKeys is empty', () => {
    expect(isResettableTarget([], 'reviewer', 'implementer')).toBe(false)
  })

  it('rejects when currentPhase is empty/null/undefined (nothing has run)', () => {
    expect(isResettableTarget(KEYS, null, 'investigator')).toBe(false)
    expect(isResettableTarget(KEYS, undefined, 'investigator')).toBe(false)
    expect(isResettableTarget(KEYS, '', 'investigator')).toBe(false)
  })

  it('rejects when currentPhase does not belong to phaseKeys (state needs repair)', () => {
    expect(isResettableTarget(KEYS, 'ghost-phase', 'investigator')).toBe(false)
  })

  it('regression: does not mutate isRunnableTarget behavior (kept as a separate function)', () => {
    expect(isRunnableTarget(KEYS, 'implementer', 'reviewer')).toBe(true)
    expect(isRunnableTarget(KEYS, 'implementer', 'designer')).toBe(false)
  })
})
