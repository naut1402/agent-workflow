import { describe, expect, it } from 'vitest'
import {
  buildHitlFromDraft,
  buildStepConfigDraft,
  buildStepUpdateFromDraft,
} from '../../../../../src/features/pipeline-editor/lib/stepConfigDraft'

describe('buildStepConfigDraft', () => {
  it('phẳng hoá hitl và copy mảng thay vì tham chiếu', () => {
    const produces = ['investigate.md']
    const knowledge = ['project/rules']
    const draft = buildStepConfigDraft({
      label: 'Điều tra',
      agent: 'plugin:investigator',
      produces,
      knowledge_inputs: knowledge,
      hitl: { mode: 'manual', gate_id: 'hitl-1', optional_doc_review: true, blocking: true },
    })!

    expect(draft).toEqual({
      name: 'Điều tra',
      agent: 'plugin:investigator',
      produces: ['investigate.md'],
      hitl_mode: 'manual',
      hitl_gate_id: 'hitl-1',
      hitl_optional_doc_review: true,
      hitl_blocking: true,
      knowledge_inputs: ['project/rules'],
    })
    // Sửa draft không được vọng lại node đang hiển thị trên canvas.
    draft.produces.push('x')
    draft.knowledge_inputs.push('y')
    expect(produces).toEqual(['investigate.md'])
    expect(knowledge).toEqual(['project/rules'])
  })

  it('trả null khi chưa chọn step — dialog dùng chính giá trị này để quyết định render', () => {
    expect(buildStepConfigDraft(null)).toBeNull()
    expect(buildStepConfigDraft(undefined)).toBeNull()
  })

  it('điền mặc định cho step thiếu field', () => {
    expect(buildStepConfigDraft({})).toEqual({
      name: '',
      agent: '',
      produces: [],
      hitl_mode: 'none',
      hitl_gate_id: '',
      hitl_optional_doc_review: false,
      hitl_blocking: false,
      knowledge_inputs: [],
    })
  })

  it('giữ false tường minh của optional_doc_review / blocking (?? chứ không ||)', () => {
    const draft = buildStepConfigDraft({
      hitl: { mode: 'auto', optional_doc_review: false, blocking: false },
    })!
    expect(draft.hitl_optional_doc_review).toBe(false)
    expect(draft.hitl_blocking).toBe(false)
  })
})

describe('buildHitlFromDraft', () => {
  const base = buildStepConfigDraft({})!

  it('mode none chỉ ghi lại { mode } — subfield khác vô nghĩa khi không có gate', () => {
    const hitl = buildHitlFromDraft(
      { ...base, hitl_mode: 'none', hitl_gate_id: 'bỏ', hitl_blocking: true },
      'step-1',
    )
    expect(hitl).toEqual({ mode: 'none' })
  })

  it('sinh gate_id từ step id khi người dùng để trống', () => {
    const hitl = buildHitlFromDraft({ ...base, hitl_mode: 'manual' }, 'design')
    expect(hitl).toEqual({
      mode: 'manual',
      gate_id: 'hitl-design',
      optional_doc_review: false,
      blocking: false,
    })
  })

  it('tôn trọng gate_id người dùng nhập', () => {
    const hitl = buildHitlFromDraft(
      { ...base, hitl_mode: 'auto', hitl_gate_id: 'gate-tay', hitl_optional_doc_review: true },
      'design',
    )
    expect(hitl).toMatchObject({ mode: 'auto', gate_id: 'gate-tay', optional_doc_review: true })
  })
})

describe('buildStepUpdateFromDraft', () => {
  it('đổi tên field name → label cho khớp data của node canvas', () => {
    const draft = buildStepConfigDraft({
      label: 'Thiết kế',
      agent: 'plugin:designer',
      produces: ['design.md'],
      knowledge_inputs: ['k1'],
      hitl: { mode: 'none' },
    })!
    expect(buildStepUpdateFromDraft(draft, 'design')).toEqual({
      label: 'Thiết kế',
      agent: 'plugin:designer',
      produces: ['design.md'],
      knowledge_inputs: ['k1'],
      hitl: { mode: 'none' },
    })
  })

  it('không sinh 3 field đã gỡ khỏi canvas (skills / rule_category / rule_required)', () => {
    const update = buildStepUpdateFromDraft(buildStepConfigDraft({})!, 'x')
    expect(Object.keys(update).sort()).toEqual(
      ['agent', 'hitl', 'knowledge_inputs', 'label', 'produces'],
    )
  })
})
