import { describe, expect, it } from 'vitest'
import { mountWithI18n } from '../../../helpers/i18n'
import TaskDraftForm from '@/features/nl-chat/components/TaskDraftForm.vue'
import type { ProfileSelectModel } from '@/features/nl-chat/lib/taskDraftFields'

/**
 * T5 — TC-F1…TC-F11 của `test-spec.md` §8.
 *
 * Form view là component CONTROLLED: không ref nội bộ nào giữ giá trị field, nên
 * mọi kỳ vọng ở đây đọc từ payload `update:draft` chứ không từ state component.
 */

const DEFAULT_OPTION = { value: '', label: '— Dùng pipeline mặc định của project —' }

function profile(over: Partial<ProfileSelectModel> = {}): ProfileSelectModel {
  return {
    state: 'ready',
    options: [DEFAULT_OPTION, { value: 'rev', label: 'rev' }],
    unknownCurrent: false,
    ...over,
  }
}

function mountForm(over: Record<string, unknown> = {}) {
  return mountWithI18n(TaskDraftForm, {
    props: {
      draft: { prompt: 'p' },
      profile: profile(),
      profileErrorText: null,
      errors: {},
      disabled: false,
      ...over,
    },
  })
}

function lastDraft(wrapper: any): Record<string, unknown> {
  const emitted = wrapper.emitted('update:draft') as unknown[][] | undefined
  if (!emitted?.length) throw new Error('chưa emit update:draft lần nào')
  return emitted[emitted.length - 1][0] as Record<string, unknown>
}

/** Khối `.nl-chat-field` của một field theo key — bắt qua id/`for` mà component sinh. */
function fieldBlock(wrapper: any, key: string) {
  return wrapper
    .findAll('.nl-chat-field')
    .find((f: any) => f.html().includes(`-${key}"`) || f.html().includes(`-${key}'`))
}

/** Khối của `profileName` — field select duy nhất. */
function profileBlock(wrapper: any) {
  return wrapper.find('.nl-chat-field--select')
}

/** Checkbox của một field boolean, nhận diện qua nhãn hiển thị. */
function boolInput(wrapper: any, label: string) {
  const block = wrapper
    .findAll('.nl-chat-field--boolean')
    .find((f: any) => f.text().trim() === label)
  if (!block) throw new Error(`không tìm thấy field boolean: ${label}`)
  return block.find('input[type="checkbox"]')
}

describe('TaskDraftForm — select pipeline profile (TC-F1…TC-F3, TC-F9, TC-F10)', () => {
  it('TC-F1: chọn "dùng pipeline mặc định" ⇒ XOÁ key profileName', async () => {
    const wrapper = mountForm({ draft: { prompt: 'p', profileName: 'rev' } })
    await wrapper.find('.c-select-trigger').trigger('click')

    const defaultOpt = wrapper
      .findAll('.c-select-option')
      .find((o: any) => o.text() === DEFAULT_OPTION.label)!
    await defaultOpt.trigger('click')

    const payload = lastDraft(wrapper)
    expect('profileName' in payload).toBe(false)
    expect(payload.prompt).toBe('p')
  })

  it('TC-F2a: state loading — select disabled và CÓ dòng chỉ báo thật sự render', async () => {
    const wrapper = mountForm({
      profile: profile({ state: 'loading', options: [DEFAULT_OPTION] }),
    })

    expect(wrapper.find('.c-select-trigger').attributes('disabled')).toBeDefined()
    // Chấm trên text ĐÃ RENDER, không trên prop `placeholder` của CSelect: với
    // draft chưa có `profileName` thì CSelect khớp option mặc định ở vị trí 0 và
    // placeholder không bao giờ hiện — assert ở mức prop vẫn xanh dù UI trống.
    const hints = profileBlock(wrapper)
      .findAll('.nl-chat-hint')
      .map((h: any) => h.text())
    expect(hints).toContain('Đang tải danh sách pipeline…')
    for (const h of hints) expect(h).not.toBe('')
    expect(wrapper.findAll('.nl-chat-profile-retry')).toHaveLength(0)
  })

  it('TC-F2b: state error — select disabled, lỗi nguyên văn, có nút Thử lại', () => {
    const wrapper = mountForm({
      profile: profile({ state: 'error', options: [DEFAULT_OPTION] }),
      profileErrorText: 'Không tải được',
    })

    expect(wrapper.find('.c-select-trigger').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.nl-chat-error').text()).toBe('Không tải được')
    expect(wrapper.find('.nl-chat-profile-retry').exists()).toBe(true)
  })

  it('TC-F2c: state empty KHÁC state error', () => {
    const wrapper = mountForm({ profile: profile({ state: 'empty', options: [DEFAULT_OPTION] }) })

    expect(wrapper.find('.c-select-trigger').attributes('disabled')).toBeUndefined()
    expect(profileBlock(wrapper).text()).toContain(
      'Project chưa có pipeline profile nào — task sẽ dùng pipeline mặc định.',
    )
    expect(wrapper.find('.nl-chat-profile-retry').exists()).toBe(false)
    expect(wrapper.find('.nl-chat-error').exists()).toBe(false)
  })

  it('TC-F2d: state ready — select bật, đủ 3 option, không hint / không Thử lại', async () => {
    const wrapper = mountForm({
      profile: profile({
        options: [DEFAULT_OPTION, { value: 'rev', label: 'rev' }, { value: 'qa', label: 'qa' }],
      }),
    })

    expect(wrapper.find('.c-select-trigger').attributes('disabled')).toBeUndefined()
    await wrapper.find('.c-select-trigger').trigger('click')
    expect(wrapper.findAll('.c-select-option')).toHaveLength(3)
    expect(profileBlock(wrapper).findAll('.nl-chat-hint')).toHaveLength(0)
    expect(wrapper.find('.nl-chat-profile-retry').exists()).toBe(false)
  })

  it('TC-F3: nút Thử lại emit retry-profiles đúng 1 lần, không emit update:draft', async () => {
    const wrapper = mountForm({
      profile: profile({ state: 'error', options: [DEFAULT_OPTION] }),
      profileErrorText: 'Không tải được',
    })
    await wrapper.find('.nl-chat-profile-retry').trigger('click')

    expect(wrapper.emitted('retry-profiles')).toHaveLength(1)
    expect(wrapper.emitted('update:draft')).toBeUndefined()
  })

  it('TC-F9: giá trị ngoài catalog hiển thị được và chọn lại được', async () => {
    const ghost = { value: 'ghost', label: 'ghost (không có trong catalog)' }
    const wrapper = mountForm({
      draft: { prompt: 'p', profileName: 'ghost' },
      profile: profile({ options: [DEFAULT_OPTION, { value: 'rev', label: 'rev' }, ghost], unknownCurrent: true }),
    })

    expect(wrapper.find('.c-select-value').text()).toContain('(không có trong catalog)')

    // Mở menu, đóng lại bằng cách chọn chính nó ⇒ giá trị không bị nuốt.
    await wrapper.find('.c-select-trigger').trigger('click')
    const ghostOpt = wrapper.findAll('.c-select-option').find((o: any) => o.text() === ghost.label)!
    await ghostOpt.trigger('click')

    expect(lastDraft(wrapper).profileName).toBe('ghost')
  })

  it('TC-F10: a11y của select — không bọc trong <label>, nhãn là <span>', () => {
    const wrapper = mountForm()
    const block = profileBlock(wrapper)

    expect(block.find('label').exists()).toBe(false)
    expect(block.find('span.nl-chat-field-label').text()).toBe('Pipeline profile')
    expect(wrapper.find('.c-select-trigger').attributes('aria-label')).toBe('Pipeline profile')
  })
})

describe('TaskDraftForm — lỗi theo field (TC-F4)', () => {
  it('TC-F4a: lỗi hiện dưới ĐÚNG control', () => {
    const wrapper = mountForm({
      draft: { prompt: '' },
      errors: { prompt: { code: 'required' } },
    })

    const promptBlock = fieldBlock(wrapper, 'prompt')!
    const err = promptBlock.find('.nl-chat-field-error')
    expect(err.attributes('role')).toBe('alert')
    expect(err.text()).toBe('Không được để trống.')
    expect(fieldBlock(wrapper, 'name')!.find('.nl-chat-field-error').exists()).toBe(false)
    expect(wrapper.findAll('.nl-chat-field-error')).toHaveLength(1)
  })

  it('TC-F4b: lỗi có tham số được nội suy', () => {
    const wrapper = mountForm({ errors: { name: { code: 'tooLong', max: 500 } } })
    expect(fieldBlock(wrapper, 'name')!.find('.nl-chat-field-error').text()).toContain('500')
  })
})

describe('TaskDraftForm — form không ghi key người dùng chưa chạm (TC-F5, TC-F6)', () => {
  it('TC-F5: hiển thị default nhưng KHÔNG emit gì khi chỉ mount', async () => {
    const wrapper = mountForm({ draft: { prompt: 'p' } })

    const sourcePrompt = wrapper.find('input[type="radio"][value="prompt"]')
    expect((sourcePrompt.element as HTMLInputElement).checked).toBe(true)
    const autoReview = boolInput(wrapper, 'Tự động review')
    expect((autoReview.element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.emitted('update:draft')).toBeUndefined()

    // Chỉ sau thao tác thật mới emit, và payload lúc đó mới mang key tương ứng.
    await autoReview.setValue(true)
    expect(lastDraft(wrapper).autoReview).toBe(true)
  })

  it('TC-F6: boolean hai chiều — tick ghi true, bỏ tick xoá key', async () => {
    const wrapper = mountForm({ draft: { prompt: 'p' } })

    await boolInput(wrapper, 'Tự động review').setValue(true)
    expect(lastDraft(wrapper).autoReview).toBe(true)

    await wrapper.setProps({ draft: { prompt: 'p', autoReview: true } })
    await boolInput(wrapper, 'Tự động review').setValue(false)
    expect('autoReview' in lastDraft(wrapper)).toBe(false)
  })
})

describe('TaskDraftForm — knowledgeInputs chỉ cho xoá (TC-F7)', () => {
  it('TC-F7a: render chip + nút xoá có aria-label, không có control thêm phần tử', () => {
    const wrapper = mountForm({ draft: { prompt: 'p', knowledgeInputs: ['a', 'b'] } })
    const chips = wrapper.findAll('.nl-chat-field--stringList .chip')

    expect(chips).toHaveLength(2)
    for (const chip of chips) {
      expect(chip.find('button').attributes('aria-label')).toBe('Bỏ knowledge')
    }
    const listBlock = wrapper.find('.nl-chat-field--stringList')
    expect(listBlock.findAll('input')).toHaveLength(0)
    expect(listBlock.findAll('textarea')).toHaveLength(0)
  })

  it('TC-F7b: xoá 1 phần tử', async () => {
    const wrapper = mountForm({ draft: { prompt: 'p', knowledgeInputs: ['a', 'b'] } })
    await wrapper.findAll('.nl-chat-field--stringList .chip button')[1].trigger('click')

    expect(lastDraft(wrapper).knowledgeInputs).toEqual(['a'])
  })

  it('TC-F7c: xoá phần tử cuối ⇒ xoá key', async () => {
    const wrapper = mountForm({ draft: { prompt: 'p', knowledgeInputs: ['a'] } })
    await wrapper.find('.nl-chat-field--stringList .chip button').trigger('click')

    expect('knowledgeInputs' in lastDraft(wrapper)).toBe(false)
  })
})

describe('TaskDraftForm — key chỉ sửa được ở JSON view (TC-F8)', () => {
  const nested = { prompt: 'p', pipeline: { steps: [] }, foo: 1 }

  it('TC-F8a: nói thẳng key nào chỉ sửa được ở JSON', () => {
    const wrapper = mountForm({ draft: nested })
    const line = wrapper.find('.nl-chat-json-only')

    expect(line.exists()).toBe(true)
    expect(line.text()).toContain('pipeline')
    expect(line.text()).toContain('foo')
  })

  it('TC-F8b: sửa field khác KHÔNG làm mất object lồng', async () => {
    const wrapper = mountForm({ draft: nested })
    const nameInput = wrapper.find('input[id$="-name"]')
    await nameInput.setValue('X')
    await nameInput.trigger('change')

    const payload = lastDraft(wrapper)
    expect(payload.pipeline).toEqual({ steps: [] })
    expect(payload.foo).toBe(1)
    expect(payload.name).toBe('X')
  })

  it('TC-F8c: draft sạch ⇒ không hiện dòng đó', () => {
    const wrapper = mountForm({ draft: { prompt: 'p', name: 'a' } })
    expect(wrapper.find('.nl-chat-json-only').exists()).toBe(false)
  })
})

describe('TaskDraftForm — khoá form khi đang gửi (TC-F11)', () => {
  it('TC-F11: mọi control disabled', () => {
    const wrapper = mountForm({
      draft: { prompt: 'p', knowledgeInputs: ['a'] },
      disabled: true,
    })

    const controls = wrapper.findAll('input, textarea')
    expect(controls.length).toBeGreaterThan(0)
    for (const c of controls) expect(c.attributes('disabled')).toBeDefined()
    expect(wrapper.find('.c-select-trigger').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.nl-chat-field--stringList .chip button').attributes('disabled')).toBeDefined()
  })
})
