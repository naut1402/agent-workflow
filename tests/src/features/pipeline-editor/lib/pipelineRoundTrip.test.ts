import { describe, expect, it } from 'vitest'
import {
  assemblePipeline,
  buildStepFromNode,
  extractPipelineMeta,
  extractStepPreservedMap,
} from '../../../../../src/features/pipeline-editor/lib/pipelineRoundTrip'

describe('extractPipelineMeta', () => {
  it('extracts version, defaults, doc_reviewer', () => {
    const meta = extractPipelineMeta({
      version: 1,
      defaults: { auto_review: true },
      doc_reviewer: { agent: 'a', rule_required: false },
      steps: [],
    })
    expect(meta).toEqual({
      version: 1,
      defaults: { auto_review: true },
      doc_reviewer: { agent: 'a', rule_required: false },
    })
  })

  it('returns empty for invalid input', () => {
    expect(extractPipelineMeta(null)).toEqual({})
    expect(extractPipelineMeta(undefined)).toEqual({})
  })
})

describe('extractStepPreservedMap', () => {
  it('preserves non-canvas step fields', () => {
    const map = extractStepPreservedMap([
      {
        id: 'investigator',
        name: 'Investigate',
        export_key: 'investigator',
        rule_fallback_skill: 'fallback',
        hitl: { mode: 'manual', retry: { on: 'must_fix', max: 2 } },
      },
    ])
    expect(map.investigator).toEqual({
      export_key: 'investigator',
      rule_fallback_skill: 'fallback',
      hitl: { retry: { on: 'must_fix', max: 2 } },
    })
  })

  // skills / rule_category / rule_required không còn do canvas quản lý: chúng rơi
  // vào `preserved` nên profile cũ mở lại rồi lưu lại vẫn giữ nguyên giá trị.
  it('treats skills / rule_category / rule_required as preserved fields', () => {
    const map = extractStepPreservedMap([
      {
        id: 'investigator',
        name: 'Investigate',
        agent: 'dev-agent-teams:investigator',
        skills: ['survey-codebase'],
        rule_category: 'doc-writing',
        rule_required: false,
        produces: ['investigate.md'],
        knowledge_inputs: [],
      },
    ])
    expect(map.investigator).toEqual({
      skills: ['survey-codebase'],
      rule_category: 'doc-writing',
      rule_required: false,
    })
  })

  it('round-trips hitl.retry via extractStepPreservedMap → buildStepFromNode', () => {
    const steps = [
      {
        id: 'investigator',
        name: 'Investigate',
        agent: 'dev-agent-teams:investigator',
        skills: ['survey-codebase'],
        rule_category: 'doc-writing',
        rule_required: true,
        produces: ['investigate.md'],
        knowledge_inputs: [],
        export_key: 'investigator',
        hitl: { mode: 'manual', gate_id: 'hitl-1', retry: { on: 'must_fix', max: 2 } },
      },
    ]
    const preservedMap = extractStepPreservedMap(steps)
    const rebuilt = buildStepFromNode(
      {
        label: 'Investigate',
        agent: 'dev-agent-teams:investigator',
        produces: ['investigate.md'],
        knowledge_inputs: [],
        hitl: { mode: 'manual', gate_id: 'hitl-1' },
      },
      'investigator',
      preservedMap.investigator,
    )
    expect(rebuilt.hitl).toEqual({
      retry: { on: 'must_fix', max: 2 },
      mode: 'manual',
      gate_id: 'hitl-1',
    })
    // Node không còn mang 3 field đó, giá trị cũ vẫn phải xuất hiện trong file lưu ra.
    expect(rebuilt.skills).toEqual(['survey-codebase'])
    expect(rebuilt.rule_category).toBe('doc-writing')
    expect(rebuilt.rule_required).toBe(true)
  })
})

describe('buildStepFromNode', () => {
  it('merges preserved export_key and hitl.retry', () => {
    const step = buildStepFromNode(
      {
        label: 'Investigate',
        agent: 'dev-agent-teams:investigator',
        produces: ['investigate.md'],
        knowledge_inputs: [],
        hitl: { mode: 'manual', gate_id: 'hitl-1' },
      },
      'investigator',
      { export_key: 'investigator', hitl: { retry: { on: 'must_fix', max: 2 } } },
    )
    expect(step.export_key).toBe('investigator')
    expect(step.hitl).toEqual({
      retry: { on: 'must_fix', max: 2 },
      mode: 'manual',
      gate_id: 'hitl-1',
    })
  })

  // Step tạo mới trong editor không sinh 3 key đã gỡ khỏi canvas.
  it('omits skills / rule_category / rule_required for a brand-new node', () => {
    const step = buildStepFromNode(
      { label: 'New', agent: 'a', produces: [], knowledge_inputs: [], hitl: { mode: 'none' } },
      'new-step',
    )
    expect(Object.keys(step)).toEqual([
      'id', 'name', 'agent', 'produces', 'knowledge_inputs', 'hitl',
    ])
  })

  it('returns mode none without preserved retry', () => {
    const step = buildStepFromNode(
      { label: 'X', hitl: { mode: 'none' } },
      'x',
      { hitl: { retry: { on: 'must_fix', max: 2 } } },
    )
    expect(step.hitl).toEqual({ mode: 'none' })
  })
})

describe('assemblePipeline', () => {
  it('round-trips meta and steps', () => {
    const pipeline = assemblePipeline(
      {
        version: 1,
        defaults: { export_json: false },
        doc_reviewer: { agent: 'doc-reviewer' },
      },
      [{ id: 's1', name: 'S1' }],
    )
    expect(pipeline).toEqual({
      version: 1,
      defaults: { export_json: false },
      steps: [{ id: 's1', name: 'S1' }],
      doc_reviewer: { agent: 'doc-reviewer' },
    })
  })

  it('omits defaults when meta empty', () => {
    const pipeline = assemblePipeline({}, [{ id: 's1', name: 'S1' }])
    expect(pipeline).toEqual({ version: 1, steps: [{ id: 's1', name: 'S1' }] })
  })
})
