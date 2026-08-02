import { describe, expect, test } from 'bun:test'
import { mergeStep, patchSteps, perTaskStepsReplace } from '../../../../src/features/pipeline-editor/business/pipeline/index'

describe('mergeStep', () => {
  test('shallow-merges fields, deep-merges hitl one level', () => {
    const base = { id: 'a', name: 'A', hitl: { mode: 'manual', gate_id: 'g1' } }
    const out = mergeStep(base, { name: 'A2', hitl: { mode: 'none' } })
    expect(out).toMatchObject({ id: 'a', name: 'A2', hitl: { mode: 'none', gate_id: 'g1' } })
  })
  test('keeps base.hitl when patch has none', () => {
    expect(mergeStep({ id: 'a', hitl: { mode: 'manual' } }, { name: 'X' }).hitl).toEqual({ mode: 'manual' })
  })
})

describe('patchSteps', () => {
  const base = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]
  test('overrides an existing step by id', () => {
    expect(patchSteps(base, [{ id: 'a', name: 'A2' }])).toEqual([{ id: 'a', name: 'A2' }, { id: 'b', name: 'B' }])
  })
  test('appends a new id', () => {
    expect(patchSteps(base, [{ id: 'c', name: 'C' }]).map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })
  test('removes a step on remove:true', () => {
    expect(patchSteps(base, [{ id: 'a', remove: true }]).map((s) => s.id)).toEqual(['b'])
  })
  test('does not mutate the base array', () => {
    patchSteps(base, [{ id: 'a', name: 'X' }])
    expect(base[0].name).toBe('A')
  })
})

describe('perTaskStepsReplace', () => {
  const base = [{ id: 'a' }, { id: 'b' }]
  test('true when steps_replace flag set', () => {
    expect(perTaskStepsReplace(base, { steps_replace: true })).toBe(true)
  })
  test('false for empty/absent steps', () => {
    expect(perTaskStepsReplace(base, {})).toBe(false)
    expect(perTaskStepsReplace(base, { steps: [] })).toBe(false)
  })
  test('true when every per-task id is new (disjoint)', () => {
    expect(perTaskStepsReplace(base, { steps: [{ id: 'x' }, { id: 'y' }] })).toBe(true)
  })
  test('false (patch mode) when any id overlaps base', () => {
    expect(perTaskStepsReplace(base, { steps: [{ id: 'a' }, { id: 'z' }] })).toBe(false)
  })
})
