import { describe, expect, it } from 'vitest'
import { deriveTimeline } from '@/features/logs/composables/useTaskTimeline'

describe('deriveTimeline', () => {
  it('returns [] for a null task', () => {
    expect(deriveTimeline(null)).toEqual([])
  })

  it('orders artifact events ascending and excludes missing artifacts', () => {
    const task = {
      artifacts: {
        'a.md': { exists: true, mtime: 200 },
        'b.md': { exists: true, mtime: 100 },
        'c.md': { exists: false },
      },
      pipeline: { steps: [] },
      current_phase: null,
      hitl_pending: null,
    }
    const events = deriveTimeline(task)
    expect(events.map((e) => e.label)).toEqual(['b.md', 'a.md'])
    expect(events.every((e) => e.kind === 'artifact')).toBe(true)
  })

  it('appends the active phase as an ongoing (ts null) event sorted last', () => {
    const task = {
      artifacts: { 'design.md': { exists: true, mtime: 500 } },
      pipeline: { steps: [{ id: 'designer', name: 'Design', produces: ['design.md'] }] },
      current_phase: 'designer',
      hitl_pending: null,
    }
    const events = deriveTimeline(task)
    const last = events[events.length - 1]
    expect(last.kind).toBe('phase')
    expect(last.ts).toBeNull()
    expect(last.label).toBe('Design')
  })

  it('emits a hitl event when a gate is pending', () => {
    const events = deriveTimeline({
      artifacts: {},
      pipeline: { steps: [] },
      current_phase: null,
      hitl_pending: 'hitl-3',
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'hitl', label: 'hitl-3', ts: null })
  })
})
