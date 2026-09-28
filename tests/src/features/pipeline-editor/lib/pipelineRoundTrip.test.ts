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

// ---------------------------------------------------------------------------
// Tbfb52394 · nhóm D của test-spec — `runner_id` (model pin cho step) đi khứ hồi.
//
// `runner_id` nằm trong CANVAS_STEP_KEYS nên nó KHÔNG còn đường `preserved`:
// giá trị ghi ra hoàn toàn do node canvas quyết định. Đó là điều kiện để gỡ pin
// trên UI có tác dụng (D06) — nhưng cũng là lý do phải ghi CÓ ĐIỀU KIỆN, nếu
// không mọi step của mọi pipeline mọc thêm `runner_id: ''` (D02/D07).
// ---------------------------------------------------------------------------

/** Mirror `buildFlowFromPipeline` của PipelineEditor.vue — YAML step → data của node. */
function nodeDataFromStep(step: Record<string, any>): Record<string, any> {
  return {
    label: step.name || step.id,
    agent: step.agent || '',
    produces: Array.isArray(step.produces) ? step.produces : [],
    knowledge_inputs: Array.isArray(step.knowledge_inputs) ? step.knowledge_inputs : [],
    hitl: step.hitl || { mode: 'none' },
    runner_id: typeof step.runner_id === 'string' ? step.runner_id : '',
  }
}

/** Mở YAML vào canvas rồi lưu lại — không sửa gì, trừ patch node do test chỉ định. */
function roundTrip(pipeline: any, patchNode: (id: string, data: any) => void = () => {}) {
  const meta = extractPipelineMeta(pipeline)
  const preservedMap = extractStepPreservedMap(pipeline.steps)
  const steps = pipeline.steps.map((step: any) => {
    const data = nodeDataFromStep(step)
    patchNode(step.id, data)
    return buildStepFromNode(data, step.id, preservedMap[step.id])
  })
  return assemblePipeline(meta, steps)
}

describe('buildStepFromNode — runner_id (model pin)', () => {
  const NODE = { label: 'Review', agent: 'a', produces: [], knowledge_inputs: [], hitl: { mode: 'none' } }

  it('TC-D01: node có runner_id ⇒ step ghi ra mang đúng giá trị đó', () => {
    const step = buildStepFromNode({ ...NODE, runner_id: 'gemini-api-runner' }, 'reviewer')
    expect(step.runner_id).toBe('gemini-api-runner')
  })

  it('TC-D02: runner_id rỗng ⇒ KHÔNG ghi key nào — 7 step không được mọc `runner_id: \'\'`', () => {
    const step = buildStepFromNode({ ...NODE, runner_id: '' }, 'reviewer')
    expect(step).not.toHaveProperty('runner_id')
    expect(Object.keys(step)).toEqual(['id', 'name', 'agent', 'produces', 'knowledge_inputs', 'hitl'])
  })

  it('TC-D03: runner_id toàn khoảng trắng ⇒ như D02, không ghi key', () => {
    expect(buildStepFromNode({ ...NODE, runner_id: '   ' }, 'reviewer')).not.toHaveProperty('runner_id')
    expect(buildStepFromNode({ ...NODE, runner_id: '\t' }, 'reviewer')).not.toHaveProperty('runner_id')
  })

  it('TC-D03b: runner_id không phải string / thiếu hẳn ⇒ không ghi key, không throw', () => {
    expect(buildStepFromNode(NODE, 'reviewer')).not.toHaveProperty('runner_id')
    expect(buildStepFromNode({ ...NODE, runner_id: 123 } as any, 'reviewer')).not.toHaveProperty('runner_id')
    expect(buildStepFromNode({ ...NODE, runner_id: null } as any, 'reviewer')).not.toHaveProperty('runner_id')
  })

  it('TC-D04: khoảng trắng thừa bị trim trước khi ghi', () => {
    const step = buildStepFromNode({ ...NODE, runner_id: '  gemini-api-runner  ' }, 'reviewer')
    expect(step.runner_id).toBe('gemini-api-runner')
  })

  it('runner_id KHÔNG rơi vào preserved — nếu rơi thì D06 không bao giờ gỡ được pin', () => {
    const map = extractStepPreservedMap([
      { id: 'reviewer', name: 'Review', runner_id: 'gemini-api-runner', export_key: 'reviewer' },
    ])
    expect(map.reviewer).toEqual({ export_key: 'reviewer' })
  })
})

describe('round-trip pipeline với runner_id', () => {
  /** Bản rút gọn của pipeline mặc định: đủ export_key / skills / rule_* / hitl.retry. */
  const PIPELINE: any = {
    version: 1,
    defaults: { review_retry_max: 2, auto_review: false, export_json: false },
    steps: [
      {
        id: 'investigator', name: 'Investigate', agent: 'dev-agent-teams:investigator',
        skills: ['survey-codebase'], rule_category: 'doc-writing', rule_required: true,
        produces: ['investigate.md'], knowledge_inputs: [], export_key: 'investigator',
        hitl: { mode: 'manual', gate_id: 'hitl-1', optional_doc_review: true },
      },
      {
        id: 'implementer', name: 'Implement', agent: 'dev-agent-teams:implementer',
        skills: ['coding-rules'], rule_category: 'coding', rule_required: false,
        rule_fallback_skill: 'coding-rules', produces: [], knowledge_inputs: [],
        export_key: 'implementer', hitl: { mode: 'none' },
      },
      {
        id: 'reviewer', name: 'Review', agent: 'dev-agent-teams:reviewer',
        skills: ['coding-rules', 'write-tests'], rule_category: ['coding', 'test'],
        rule_required: false, rule_fallback_skill: 'coding-rules',
        produces: ['review.md', 'test-spec.md'], knowledge_inputs: [], export_key: 'reviewer',
        hitl: {
          mode: 'manual', gate_id: 'hitl-3', blocking: true,
          retry: { on: 'must_fix', restart_from: 'implementer', max: 2 },
        },
      },
    ],
    doc_reviewer: { agent: 'dev-agent-teams:doc-reviewer', skills: ['doc-review'] },
    orchestrator: { enabled: true, agent: 'dev-agent-teams:orchestrator' },
  }

  function pinned(stepId: string, runnerId: string) {
    return {
      ...PIPELINE,
      steps: PIPELINE.steps.map((s: any) => (s.id === stepId ? { ...s, runner_id: runnerId } : s)),
    }
  }

  it('TC-D07: pipeline không pin — mở rồi lưu không sửa gì ⇒ ra BẰNG vào', () => {
    expect(roundTrip(PIPELINE)).toEqual(PIPELINE)
  })

  it('TC-D05: step đã pin — mở rồi lưu không sửa gì ⇒ pin còn nguyên, không step nào mọc thêm', () => {
    const input = pinned('reviewer', 'gemini-api-runner')
    const out: any = roundTrip(input)
    expect(out).toEqual(input)
    expect(out.steps.filter((s: any) => 'runner_id' in s).map((s: any) => s.id)).toEqual(['reviewer'])
  })

  it('TC-D06: gỡ pin trên UI ⇒ key runner_id BIẾN MẤT khỏi YAML', () => {
    const input = pinned('reviewer', 'gemini-api-runner')
    const out: any = roundTrip(input, (id, data) => {
      if (id === 'reviewer') data.runner_id = ''
    })
    expect(out.steps.some((s: any) => 'runner_id' in s)).toBe(false)
    // Mọi thứ còn lại của step đó không được đụng vào.
    const reviewer = out.steps.find((s: any) => s.id === 'reviewer')
    expect(reviewer.skills).toEqual(['coding-rules', 'write-tests'])
    expect(reviewer.hitl.retry).toEqual({ on: 'must_fix', restart_from: 'implementer', max: 2 })
  })

  it('TC-D06b: đổi pin sang runner khác ⇒ giá trị mới thắng, preserved không dội ngược', () => {
    const input = pinned('reviewer', 'cu')
    const out: any = roundTrip(input, (id, data) => {
      if (id === 'reviewer') data.runner_id = 'moi'
    })
    expect(out.steps.find((s: any) => s.id === 'reviewer').runner_id).toBe('moi')
  })

  it('pin thêm cho một step chưa pin ⇒ chỉ step đó có key', () => {
    const out: any = roundTrip(PIPELINE, (id, data) => {
      if (id === 'implementer') data.runner_id = 'gemini-api-runner'
    })
    expect(out.steps.filter((s: any) => 'runner_id' in s).map((s: any) => s.id)).toEqual(['implementer'])
  })
})
