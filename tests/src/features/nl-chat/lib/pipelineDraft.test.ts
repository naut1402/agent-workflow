import { describe, expect, it } from 'vitest'
import { normalizePipelineDraft } from '@/features/nl-chat/lib/pipelineDraft'

// The Pipeline Editor keys every canvas node on `step.id` and drops steps
// without one, so an agent-generated profile must carry ids to be reopenable.

describe('normalizePipelineDraft', () => {
  it('derives a kebab-case id from name, then agent, then position', () => {
    const out = normalizePipelineDraft({
      steps: [
        { name: 'Điều tra Codebase', agent: 'plugin:dev-agent-teams:investigator' },
        { agent: 'plugin:dev-agent-teams:implementer' },
        {},
      ],
    })
    expect((out.steps as any[]).map((s) => s.id)).toEqual(['dieu-tra-codebase', 'implementer', 'step-3'])
  })

  it('keeps an id the agent already provided', () => {
    const out = normalizePipelineDraft({ steps: [{ id: 'review', agent: 'a', name: 'Review' }] })
    expect((out.steps as any[])[0]).toMatchObject({ id: 'review', name: 'Review', agent: 'a' })
  })

  it('makes duplicate ids unique — Vue Flow would silently drop a repeated node id', () => {
    const out = normalizePipelineDraft({
      steps: [{ agent: 'x', name: 'Review' }, { agent: 'y', name: 'Review' }, { id: 'review' }],
    })
    expect((out.steps as any[]).map((s) => s.id)).toEqual(['review', 'review-2', 'review-3'])
  })

  it('fills name and hitl defaults but leaves other fields untouched', () => {
    const out = normalizePipelineDraft({
      steps: [{ id: 'impl', agent: 'a', produces: ['impl.md'], hitl: { mode: 'approve' } }],
    })
    expect((out.steps as any[])[0]).toEqual({
      id: 'impl',
      name: 'impl',
      agent: 'a',
      produces: ['impl.md'],
      hitl: { mode: 'approve' },
    })
  })

  it('defaults version to 1 and preserves an explicit one plus extra top-level keys', () => {
    expect(normalizePipelineDraft({ steps: [] }).version).toBe(1)
    const out = normalizePipelineDraft({ version: 2, defaults: { agent: 'a' }, steps: [] })
    expect(out).toMatchObject({ version: 2, defaults: { agent: 'a' } })
  })

  it('tolerates a missing/!array steps field and never mutates the input', () => {
    const input = { steps: [{ agent: 'a' }] }
    const out = normalizePipelineDraft(input)
    expect(out.steps).toEqual([{ id: 'a', name: 'a', agent: 'a', hitl: { mode: 'none' } }])
    expect(input.steps[0]).toEqual({ agent: 'a' })
    expect(normalizePipelineDraft({}).steps).toEqual([])
    expect(normalizePipelineDraft(null).steps).toEqual([])
  })
})
