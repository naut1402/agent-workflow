import { describe, expect, it } from 'vitest'
import { parseTaskState, TaskState } from './task'

describe('parseTaskState', () => {
  it('applies safe defaults for an empty/invalid input', () => {
    expect(parseTaskState({})).toEqual({
      parent_task_id: null,
      current_phase: null,
      hitl_pending: null,
      review_round: 0,
      auto_review: false,
      doc_review_round: { investigate: 0, design: 0 },
      inherit_from_parent: [],
      export_json: false,
    })
  })

  it('defaults gracefully on non-object input (never throws)', () => {
    expect(parseTaskState('garbage').current_phase).toBeNull()
    expect(parseTaskState(null).review_round).toBe(0)
  })

  it('preserves provided fields', () => {
    const v = parseTaskState({
      current_phase: 'design',
      hitl_pending: 'design',
      review_round: 2,
      auto_review: true,
      export_json: true,
      inherit_from_parent: ['investigate.md'],
    })
    expect(v.current_phase).toBe('design')
    expect(v.hitl_pending).toBe('design')
    expect(v.review_round).toBe(2)
    expect(v.auto_review).toBe(true)
    expect(v.export_json).toBe(true)
    expect(v.inherit_from_parent).toEqual(['investigate.md'])
  })

  it('merges doc_review_round over the defaults', () => {
    expect(parseTaskState({ doc_review_round: { investigate: 3 } }).doc_review_round).toMatchObject({
      investigate: 3,
      design: 0,
    })
  })

  it('TaskState passes through unknown keys (forward-compatible)', () => {
    const parsed = TaskState.parse({ current_phase: 'pr', future_field: 42 })
    expect((parsed as Record<string, unknown>).future_field).toBe(42)
  })
})
