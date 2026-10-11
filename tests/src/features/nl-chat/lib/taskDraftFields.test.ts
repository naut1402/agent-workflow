import { describe, expect, it } from 'vitest'
import {
  TASK_DRAFT_FIELDS,
  applyFieldChange,
  buildProfileOptions,
  fieldErrors,
  jsonOnlyKeys,
  toFieldValue,
  visibleFields,
  type TaskDraftFieldDef,
} from '@/features/nl-chat/lib/taskDraftFields'

/**
 * T1 — TC-L1…TC-L12 của `test-spec.md` §4.
 *
 * Mọi luật dễ sai của form draft (xoá key vs ghi '', 4 trạng thái select, quy
 * lỗi Zod) đã được đẩy xuống đây nên phủ dày nhất ở tầng này: không DOM, và
 * kỳ vọng nói đúng thứ gọi được từ ngoài.
 */

function def(key: string): TaskDraftFieldDef {
  const found = TASK_DRAFT_FIELDS.find((f) => f.key === key)
  if (!found) throw new Error(`no field def: ${key}`)
  return found
}

const defName = def('name')
const defPrompt = def('prompt')
const defProfileName = def('profileName')
const defSource = def('source')
const defAutoReview = def('autoReview')
const defKnowledge = def('knowledgeInputs')

/** Input đủ field cho `buildProfileOptions` — từng case chỉ ghi đè phần nó chấm. */
function profileInput(over: Partial<Parameters<typeof buildProfileOptions>[0]> = {}) {
  return {
    names: new Set<string>(),
    loading: false,
    hasError: false,
    current: '',
    defaultOptionLabel: '— mặc định —',
    unknownSuffix: '(không có trong catalog)',
    ...over,
  }
}

describe('visibleFields — TC-L1', () => {
  it('TC-L1a: draft tối thiểu chỉ render 7 field always, đúng thứ tự khai báo', () => {
    const keys = visibleFields({ prompt: 'x' }).map((f) => f.key)
    expect(keys).toEqual([
      'name',
      'prompt',
      'profileName',
      'source',
      'autoReview',
      'exportJson',
      'run',
    ])
    for (const absent of [
      'taskId',
      'issueUrl',
      'branch',
      'parentTaskId',
      'runnerId',
      'knowledgeInputs',
    ]) {
      expect(keys).not.toContain(absent)
    }
  })

  it('TC-L1b: field optional xuất hiện khi draft có key, giữ nguyên thứ tự khai báo', () => {
    const keys = visibleFields({ prompt: 'x', issueUrl: 'https://e/1' }).map((f) => f.key)
    expect(keys).toContain('issueUrl')
    expect(keys.indexOf('issueUrl')).toBeGreaterThan(keys.indexOf('source'))
    expect(keys.indexOf('issueUrl')).toBeLessThan(keys.indexOf('autoReview'))
  })

  it('TC-L1c: draft rỗng vẫn render được form', () => {
    expect(visibleFields({}).map((f) => f.key)).toEqual(
      visibleFields({ prompt: 'x' }).map((f) => f.key),
    )
  })

  it('TC-L1d: key lạ không sinh control', () => {
    const keys = visibleFields({ prompt: 'x', foo: 1 }).map((f) => f.key)
    expect(keys).not.toContain('foo')
  })
})

describe('applyFieldChange — TC-L2…TC-L5', () => {
  it('TC-L2: không bao giờ mutate draft gốc', () => {
    const d: Record<string, unknown> = { prompt: 'p', name: 'a' }
    const before = structuredClone(d)
    const next = applyFieldChange(d, defName, 'X')

    expect(next).not.toBe(d)
    expect(d).toEqual(before)
    expect(next.name).toBe('X')
    expect(next.prompt).toBe('p')
  })

  it('TC-L3a: chuỗi rỗng ⇒ XOÁ HẲN key (không phải rỗng/null/undefined)', () => {
    const next = applyFieldChange({ prompt: 'p', profileName: 'rev' }, defProfileName, '')
    expect('profileName' in next).toBe(false)
    expect(next.prompt).toBe('p')
  })

  it('TC-L3b: toàn khoảng trắng cũng là rỗng', () => {
    const next = applyFieldChange({ prompt: 'p', profileName: 'rev' }, defProfileName, '   ')
    expect('profileName' in next).toBe(false)
  })

  it('TC-L3c: chuỗi được trim trước khi ghi', () => {
    const next = applyFieldChange({ prompt: 'p' }, defProfileName, '  x  ')
    expect(next.profileName).toBe('x')
  })

  it('TC-L3d: trim không đổi hoa thường', () => {
    const next = applyFieldChange({ prompt: 'p' }, defProfileName, ' Review ')
    expect(next.profileName).toBe('Review')
  })

  it('TC-L3e: field clearOnEmpty:false thì rỗng vẫn ghi, key còn lại cho fieldErrors bắt', () => {
    const next = applyFieldChange({ prompt: 'p' }, defPrompt, '')
    expect(next.prompt).toBe('')
    expect('prompt' in next).toBe(true)
  })

  it('TC-L4: boolean — bỏ tick xoá key, tick ghi true', () => {
    const off = applyFieldChange({ prompt: 'p', autoReview: true }, defAutoReview, false)
    expect('autoReview' in off).toBe(false)

    const on = applyFieldChange({ prompt: 'p' }, defAutoReview, true)
    expect(on.autoReview).toBe(true)
  })

  it('TC-L5a: stringList rỗng ⇒ xoá key', () => {
    const next = applyFieldChange({ prompt: 'p', knowledgeInputs: ['a'] }, defKnowledge, [])
    expect('knowledgeInputs' in next).toBe(false)
  })

  it('TC-L5b: stringList còn phần tử ⇒ ghi mảng mới, không mutate mảng gốc', () => {
    const arr = ['a', 'b']
    const next = applyFieldChange({ prompt: 'p', knowledgeInputs: arr }, defKnowledge, ['a'])
    expect(next.knowledgeInputs).toEqual(['a'])
    expect(arr).toEqual(['a', 'b'])
  })
})

describe('fieldErrors — TC-L6, TC-L7', () => {
  it('TC-L6: lấy lỗi KHÔNG làm draft mọc thêm field default', () => {
    const d: Record<string, unknown> = { prompt: 'x' }
    expect(fieldErrors(d)).toEqual({})
    expect(Object.keys(d)).toEqual(['prompt'])
  })

  it('TC-L7a: bắt buộc', () => {
    expect(fieldErrors({ prompt: '' }).prompt).toEqual({ code: 'required' })
  })

  it('TC-L7b: quá dài, kèm ngưỡng', () => {
    const errors = fieldErrors({ prompt: 'x', name: 'a'.repeat(501) })
    expect(errors.name).toMatchObject({ code: 'tooLong', max: 500 })
  })

  it('TC-L7c: URL', () => {
    expect(fieldErrors({ prompt: 'x', issueUrl: 'abc' }).issueUrl.code).toBe('invalidUrl')
  })

  it('TC-L7d: pattern (branch)', () => {
    expect(fieldErrors({ prompt: 'x', branch: 'a b' }).branch.code).toBe('invalidPattern')
  })

  it('TC-L7e: pattern (taskId)', () => {
    expect(fieldErrors({ prompt: 'x', taskId: '-x' }).taskId.code).toBe('invalidPattern')
  })

  it('TC-L7f: draft hợp lệ ⇒ không lỗi', () => {
    expect(fieldErrors({ prompt: 'x', name: 'ok', profileName: 'rev' })).toEqual({})
  })

  it('TC-L7g: key lồng quy về key gốc', () => {
    const errors = fieldErrors({ prompt: 'x', knowledgeInputs: ['a', 'b', ''] })
    expect(Object.keys(errors)).toEqual(['knowledgeInputs'])
    expect('2' in errors).toBe(false)
    expect('knowledgeInputs.2' in errors).toBe(false)
  })

  it('TC-L7h: một field nhiều lỗi ⇒ giữ MỘT lỗi đầu tiên', () => {
    // `name` không thể vi phạm 2 luật cùng lúc (`min(1)` và `max(500)` loại trừ
    // nhau), nên chấm trên `branch`: regex + max(200) cùng đỏ với một giá trị.
    const errors = fieldErrors({ prompt: 'x', branch: `a b${'c'.repeat(300)}` })
    expect(Array.isArray(errors.branch)).toBe(false)
    expect(Object.keys(errors.branch)).toContain('code')
    expect(errors.branch.code).toBe('invalidPattern')
  })
})

describe('buildProfileOptions — TC-L8…TC-L10', () => {
  it('TC-L8a: names null + loading ⇒ loading', () => {
    expect(buildProfileOptions(profileInput({ names: null, loading: true })).state).toBe('loading')
  })

  it('TC-L8b: names null + loading:false vẫn là loading (chưa biết ≠ rỗng)', () => {
    expect(buildProfileOptions(profileInput({ names: null, loading: false })).state).toBe('loading')
  })

  it('TC-L8c: hasError thắng mọi thứ, kể cả khi names khác null', () => {
    const model = buildProfileOptions(
      profileInput({ names: new Set(['rev']), loading: false, hasError: true }),
    )
    expect(model.state).toBe('error')
  })

  it('TC-L8d: set rỗng + đã tải xong ⇒ empty', () => {
    expect(buildProfileOptions(profileInput({ names: new Set() })).state).toBe('empty')
  })

  it('TC-L8e: có tên ⇒ ready', () => {
    const model = buildProfileOptions(profileInput({ names: new Set(['rev', 'build']) }))
    expect(model.state).toBe('ready')
    expect(model.options.map((o) => o.value)).toEqual(expect.arrayContaining(['rev', 'build']))
  })

  it('TC-L8f (Q1): names đã có nhưng đang tải lại ⇒ loading', () => {
    const model = buildProfileOptions(profileInput({ names: new Set(['rev']), loading: true }))
    expect(model.state).toBe('loading')
  })

  it('TC-L9: option đầu LUÔN là option mặc định ở cả 4 state', () => {
    const inputs = [
      profileInput({ names: null, loading: true }),
      profileInput({ names: new Set(['rev']), hasError: true }),
      profileInput({ names: new Set() }),
      profileInput({ names: new Set(['rev', 'build']) }),
    ]
    for (const input of inputs) {
      const model = buildProfileOptions(input)
      expect(model.options[0]).toEqual({ value: '', label: '— mặc định —' })
    }
  })

  it('TC-L10a: giá trị agent bịa không bị mất', () => {
    const model = buildProfileOptions(profileInput({ names: new Set(['rev']), current: 'ghost' }))
    expect(model.unknownCurrent).toBe(true)
    expect(model.options).toContainEqual({
      value: 'ghost',
      label: 'ghost (không có trong catalog)',
    })
  })

  it('TC-L10b: so khớp phân biệt hoa thường', () => {
    const model = buildProfileOptions(
      profileInput({ names: new Set(['review']), current: 'Review' }),
    )
    expect(model.unknownCurrent).toBe(true)
    expect(model.options.map((o) => o.value)).toContain('Review')
  })

  it('TC-L10c: khớp đúng ⇒ không chèn gì', () => {
    const model = buildProfileOptions(
      profileInput({ names: new Set(['review']), current: 'review' }),
    )
    expect(model.unknownCurrent).toBe(false)
    expect(model.options).toHaveLength(2)
  })

  it("TC-L10d: current '' không phải \"không biết\"", () => {
    const model = buildProfileOptions(profileInput({ names: new Set(['review']), current: '' }))
    expect(model.unknownCurrent).toBe(false)
  })

  it('TC-L10e: loading/error ⇒ chưa kết luận được là lạ', () => {
    expect(
      buildProfileOptions(profileInput({ names: null, current: 'ghost' })).unknownCurrent,
    ).toBe(false)
    expect(
      buildProfileOptions(
        profileInput({ names: new Set(['rev']), hasError: true, current: 'ghost' }),
      ).unknownCurrent,
    ).toBe(false)
  })
})

describe('jsonOnlyKeys — TC-L11', () => {
  it('TC-L11a: liệt kê cả object lồng lẫn key lạ', () => {
    const keys = jsonOnlyKeys({ prompt: 'x', pipeline: { steps: [] }, foo: 1 })
    expect(keys).toContain('pipeline')
    expect(keys).toContain('foo')
  })

  it('TC-L11b: draft sạch ⇒ rỗng', () => {
    expect(jsonOnlyKeys({ prompt: 'x', name: 'a', autoReview: true })).toEqual([])
  })
})

describe('toFieldValue — TC-L12', () => {
  it('TC-L12: trả giá trị hiển thị mà KHÔNG ghi vào draft', () => {
    const d: Record<string, unknown> = {}
    expect(toFieldValue(d, defSource)).toBe('prompt')
    expect(toFieldValue(d, defAutoReview)).toBe(false)
    expect(toFieldValue(d, defName)).toBe('')
    expect(toFieldValue(d, defKnowledge)).toEqual([])
    expect(Object.keys(d)).toEqual([])
  })
})
