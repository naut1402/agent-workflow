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
      runner_id: '',
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
      runner_id: '',
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
      runner_id: '',
    })
  })

  it('không sinh 3 field đã gỡ khỏi canvas (skills / rule_category / rule_required)', () => {
    const update = buildStepUpdateFromDraft(buildStepConfigDraft({})!, 'x')
    expect(Object.keys(update).sort()).toEqual(
      ['agent', 'hitl', 'knowledge_inputs', 'label', 'produces', 'runner_id'],
    )
  })
})

// Tbfb52394 · nhóm D của test-spec — `runner_id` trong draft/payload của dialog.
describe('runner_id trong draft cấu hình step', () => {
  it('TC-D09: step không có runner_id ⇒ draft là chuỗi rỗng, không phải undefined', () => {
    const draft = buildStepConfigDraft({ label: 'Review' })!
    // CSelect bind `modelValue: string`; `undefined` làm control không có giá trị
    // xác định để so với option "theo mặc định hệ thống".
    expect(draft.runner_id).toBe('')
    expect('runner_id' in draft).toBe(true)
  })

  it('TC-D09b: step có runner_id ⇒ draft mang đúng giá trị để control tự chọn sẵn', () => {
    expect(buildStepConfigDraft({ runner_id: 'gemini-api-runner' })!.runner_id).toBe('gemini-api-runner')
  })

  it('TC-D08: payload update LUÔN mang key runner_id, kể cả rỗng', () => {
    // `applyStepUpdate` merge node bằng `{ ...n.data, ...updatedData }` — bỏ key
    // khi rỗng thì gỡ pin không xoá được giá trị cũ trên node canvas.
    const pinned = buildStepConfigDraft({ runner_id: 'gemini-api-runner' })!
    expect(buildStepUpdateFromDraft(pinned, 'reviewer').runner_id).toBe('gemini-api-runner')

    const cleared = { ...pinned, runner_id: '' }
    const update = buildStepUpdateFromDraft(cleared, 'reviewer')
    expect(update.runner_id).toBe('')
    expect('runner_id' in update).toBe(true)
  })

  it('TC-D08b: đổi pin đi qua nguyên vẹn, không bị chuẩn hoá mất giá trị', () => {
    const draft = { ...buildStepConfigDraft({ runner_id: 'cu' })!, runner_id: 'moi' }
    expect(buildStepUpdateFromDraft(draft, 'reviewer').runner_id).toBe('moi')
  })
})
