import { describe, expect, it } from 'vitest'
import { PHASES, phasesFromPipeline, phaseStatus, type Phase } from '../../../../src/core/lib/phase'
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
})

describe('qs', () => {
  it('drops null/undefined/empty and url-encodes', () => {
    expect(qs({ a: '1', b: null, c: undefined, d: '', e: 'x y' })).toBe('?a=1&e=x%20y')
    expect(qs(null)).toBe('')
    expect(qs({})).toBe('')
  })
})
