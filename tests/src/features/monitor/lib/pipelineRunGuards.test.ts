import { describe, expect, it } from 'vitest'
import { canRunWithTaskState, isRunnableTarget } from '@/features/monitor/lib/pipelineRunGuards'

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
