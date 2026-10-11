import { describe, expect, it } from 'vitest'
import { mountWithI18n } from '../../../helpers/i18n'
import DraftEditor from '@/features/nl-chat/components/DraftEditor.vue'
import type { ProfileSelectModel } from '@/features/nl-chat/lib/taskDraftFields'

/**
 * T4 — TC-D1…TC-D9 của `test-spec.md` §7.
 *
 * `DraftEditor` là component CONTROLLED: `draft` vào bằng prop, mọi thay đổi ra
 * bằng `update:draft`. Mọi case ở đây phải tự đóng vai cha — nhận emit rồi
 * `setProps` lại — nếu không thì chiều đồng bộ thứ hai không bao giờ chạy.
 */

const READY_PROFILE: ProfileSelectModel = {
  state: 'ready',
  options: [
    { value: '', label: '— Dùng pipeline mặc định của project —' },
    { value: 'rev', label: 'rev' },
  ],
  unknownCurrent: false,
}

function mountEditor(over: Record<string, unknown> = {}) {
  return mountWithI18n(DraftEditor, {
    props: {
      draft: { prompt: 'p' },
      entityType: 'task',
      profile: READY_PROFILE,
      profileErrorText: null,
      chatUpdated: false,
      attachWarning: false,
      disabled: false,
      ...over,
    },
  })
}

/** Nút trong nhóm toggle theo nhãn hiển thị. */
function toggleBtn(wrapper: any, label: 'JSON view' | 'Form view') {
  return wrapper
    .findAll('.nl-chat-view-toggle button')
    .find((b: any) => b.text() === label)
}

function jsonBox(wrapper: any) {
  return wrapper.find('.nl-chat-draft-textarea')
}

/** Payload của lần emit `update:draft` gần nhất. */
function lastDraft(wrapper: any): Record<string, unknown> {
  const emitted = wrapper.emitted('update:draft') as unknown[][] | undefined
  if (!emitted?.length) throw new Error('chưa emit update:draft lần nào')
  return emitted[emitted.length - 1][0] as Record<string, unknown>
}

/** Payload của lần emit `update:editorError` gần nhất. */
function lastEditorError(wrapper: any): string | null {
  const emitted = wrapper.emitted('update:editorError') as unknown[][] | undefined
  if (!emitted?.length) throw new Error('chưa emit update:editorError lần nào')
  return emitted[emitted.length - 1][0] as string | null
}

describe('DraftEditor — đồng bộ hai chiều Form ⇄ JSON', () => {
  it('TC-D1: sửa ở Form, bật JSON view thấy ngay', async () => {
    const wrapper = mountEditor()
    await toggleBtn(wrapper, 'Form view')!.trigger('click')

    const nameInput = wrapper.find('input[id$="-name"]')
    await nameInput.setValue('X')
    await nameInput.trigger('change')

    expect(lastDraft(wrapper).name).toBe('X')

    await wrapper.setProps({ draft: lastDraft(wrapper) })
    await toggleBtn(wrapper, 'JSON view')!.trigger('click')

    expect((jsonBox(wrapper).element as HTMLTextAreaElement).value).toContain('"name": "X"')
  })

  it('TC-D2: sửa ở JSON, bật Form view thấy ngay', async () => {
    const wrapper = mountEditor()
    await jsonBox(wrapper).setValue('{"prompt":"p","name":"Y"}')

    expect(lastDraft(wrapper)).toEqual({ prompt: 'p', name: 'Y' })

    await wrapper.setProps({ draft: lastDraft(wrapper) })
    await toggleBtn(wrapper, 'Form view')!.trigger('click')

    expect((wrapper.find('input[id$="-name"]').element as HTMLInputElement).value).toBe('Y')
  })
})

describe('DraftEditor — JSON hỏng chặn toggle (TC-D3)', () => {
  it('TC-D3a: JSON hỏng ⇒ chặn Form view, giữ draft cũ, không emit update:draft', async () => {
    const wrapper = mountEditor()
    await jsonBox(wrapper).setValue('{"prompt":')

    expect(toggleBtn(wrapper, 'Form view')!.attributes('disabled')).toBeDefined()
    expect(wrapper.find('.nl-chat-error').text()).toBe(
      'JSON không hợp lệ — sửa lại để bật được Form view.',
    )
    expect(wrapper.emitted('update:draft')).toBeUndefined()
    expect(typeof lastEditorError(wrapper)).toBe('string')
  })

  it('TC-D3b: sửa JSON đúng lại ⇒ mở khoá', async () => {
    const wrapper = mountEditor()
    await jsonBox(wrapper).setValue('{"prompt":')
    await jsonBox(wrapper).setValue('{"prompt":"p"}')

    expect(toggleBtn(wrapper, 'Form view')!.attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.nl-chat-error').exists()).toBe(false)
    expect(lastEditorError(wrapper)).toBeNull()
    expect(lastDraft(wrapper)).toEqual({ prompt: 'p' })
  })

  it('TC-D3c: JSON hợp lệ nhưng không phải object', async () => {
    for (const raw of ['[1,2]', '"abc"', 'null']) {
      const wrapper = mountEditor()
      await jsonBox(wrapper).setValue(raw)

      expect(wrapper.find('.nl-chat-error').text(), raw).toBe('Draft phải là một object JSON.')
      expect(toggleBtn(wrapper, 'Form view')!.attributes('disabled'), raw).toBeDefined()
      expect(wrapper.emitted('update:draft'), raw).toBeUndefined()
    }
  })

  it('TC-D3d: guard thứ hai — click cưỡng bức khi JSON hỏng vẫn ở JSON view', async () => {
    const wrapper = mountEditor()
    await jsonBox(wrapper).setValue('{"prompt":')
    await toggleBtn(wrapper, 'Form view')!.trigger('click')

    expect(jsonBox(wrapper).exists()).toBe(true)
    expect(wrapper.find('.nl-chat-draft-form').exists()).toBe(false)
  })
})

describe('DraftEditor — tiếng vọng của chính ô JSON (TC-D4)', () => {
  it('TC-D4: prop đổi bằng chính object vừa emit ⇒ KHÔNG viết lại ô', async () => {
    const wrapper = mountEditor()
    const typed = '{\n      "prompt": "p",\n  "name":"Y"\n}'
    await jsonBox(wrapper).setValue(typed)

    await wrapper.setProps({ draft: lastDraft(wrapper) })

    expect((jsonBox(wrapper).element as HTMLTextAreaElement).value).toBe(typed)
  })

  it('TC-D4b: draft đổi từ nguồn khác ⇒ ô JSON phải cập nhật, lỗi parse cũ bị xoá', async () => {
    const wrapper = mountEditor()
    await jsonBox(wrapper).setValue('{"prompt":')
    expect(wrapper.find('.nl-chat-error').exists()).toBe(true)

    const fromChat = { prompt: 'p', name: 'Z' }
    await wrapper.setProps({ draft: fromChat })

    expect((jsonBox(wrapper).element as HTMLTextAreaElement).value).toBe(
      JSON.stringify(fromChat, null, 2),
    )
    expect(wrapper.find('.nl-chat-error').exists()).toBe(false)
  })

  it('TC-D4c (nợ test review): prop quay LẠI object đã emit sau khi đi qua object khác ⇒ ô phải cập nhật', async () => {
    // Kịch bản Hoàn tác: `undoDraftUpdate()` khôi phục bằng CHÍNH tham chiếu đã
    // chụp, nên object từng là "tiếng vọng" quay về lần thứ hai. Giữ dấu cũ thì
    // watcher coi đây vẫn là tiếng vọng và ô JSON kẹt ở bản của agent.
    // TC-D4b dùng object HOÀN TOÀN MỚI nên không bắt được lỗi này.
    const wrapper = mountEditor()
    const typed = '{"prompt":"p","name":"user"}'
    await jsonBox(wrapper).setValue(typed)
    const mine = lastDraft(wrapper)

    await wrapper.setProps({ draft: mine }) // tiếng vọng — ô giữ nguyên chuỗi đã gõ
    expect((jsonBox(wrapper).element as HTMLTextAreaElement).value).toBe(typed)

    await wrapper.setProps({ draft: { prompt: 'p', name: 'agent' } }) // draft từ chat
    await wrapper.setProps({ draft: mine }) // Hoàn tác — chính object cũ quay lại

    expect((jsonBox(wrapper).element as HTMLTextAreaElement).value).toBe(
      JSON.stringify(mine, null, 2),
    )
  })
})

describe('DraftEditor — loại draft, banner, cảnh báo (TC-D5…TC-D7)', () => {
  it('TC-D5: loại draft khác task giữ JSON view và không chấm field', async () => {
    for (const entityType of ['pipeline', 'agent', 'automation'] as const) {
      const wrapper = mountEditor({ entityType, draft: { steps: [] } })

      expect(toggleBtn(wrapper, 'Form view'), entityType).toBeUndefined()
      expect(wrapper.find('.nl-chat-view-toggle').exists(), entityType).toBe(false)
      expect(jsonBox(wrapper).exists(), entityType).toBe(true)
      expect(lastEditorError(wrapper), entityType).toBeNull()
    }
  })

  it('TC-D6a: banner chỉ hiện khi chatUpdated', async () => {
    const wrapper = mountEditor({ chatUpdated: false })
    expect(wrapper.find('.nl-chat-draft-banner').exists()).toBe(false)

    await wrapper.setProps({ chatUpdated: true })
    const banner = wrapper.find('.nl-chat-draft-banner')
    expect(banner.exists()).toBe(true)
    expect(banner.attributes('role')).toBe('status')
    expect(banner.text()).toContain('Draft đã cập nhật theo yêu cầu chat.')
  })

  it('TC-D6b: bấm Hoàn tác ⇒ emit undo, không emit update:draft', async () => {
    const wrapper = mountEditor({ chatUpdated: true })
    await wrapper.find('.nl-chat-draft-undo').trigger('click')

    expect(wrapper.emitted('undo')).toHaveLength(1)
    expect(wrapper.emitted('update:draft')).toBeUndefined()
  })

  it('TC-D6c: nút đóng ⇒ emit dismiss-banner, có nhãn a11y', async () => {
    const wrapper = mountEditor({ chatUpdated: true })
    const close = wrapper.find('.nl-chat-draft-banner .icon-btn')

    expect(close.attributes('title')).toBeTruthy()
    expect(close.attributes('aria-label')).toBeTruthy()

    await close.trigger('click')
    expect(wrapper.emitted('dismiss-banner')).toHaveLength(1)
  })

  it('TC-D7: cảnh báo draft quá dài bật rồi tắt', async () => {
    const wrapper = mountEditor({ attachWarning: true })
    expect(wrapper.find('.nl-chat-nudge').text()).toContain('Draft quá dài để gửi kèm')

    await wrapper.setProps({ attachWarning: false })
    expect(wrapper.find('.nl-chat-nudge').exists()).toBe(false)
  })
})

describe('DraftEditor — lỗi field đẩy lên cha (TC-D8) và disabled (TC-D9)', () => {
  it('TC-D8a: lỗi field ⇒ editorError là chuỗi', () => {
    const wrapper = mountEditor({ draft: { prompt: '' } })
    expect(lastEditorError(wrapper)).toBe('Còn field chưa hợp lệ — xem lỗi ở Form view.')
  })

  it('TC-D8b: sửa hết lỗi ⇒ mở khoá', async () => {
    const wrapper = mountEditor({ draft: { prompt: '' } })
    await wrapper.setProps({ draft: { prompt: 'ok' } })

    expect(lastEditorError(wrapper)).toBeNull()
  })

  it('TC-D8c: lỗi parse thắng lỗi field', async () => {
    const wrapper = mountEditor({ draft: { prompt: '' } })
    await jsonBox(wrapper).setValue('{"prompt":')

    expect(lastEditorError(wrapper)).toBe('JSON không hợp lệ — sửa lại để bật được Form view.')
  })

  it('TC-D9: disabled truyền xuống mọi control', async () => {
    const wrapper = mountEditor({ disabled: true, draft: { prompt: 'p', knowledgeInputs: ['a'] } })
    expect(jsonBox(wrapper).attributes('disabled')).toBeDefined()

    await toggleBtn(wrapper, 'Form view')!.trigger('click')
    const controls = wrapper.findAll('.nl-chat-draft-form input, .nl-chat-draft-form textarea')
    expect(controls.length).toBeGreaterThan(0)
    for (const c of controls) expect(c.attributes('disabled')).toBeDefined()
    expect(wrapper.find('.c-select-trigger').attributes('disabled')).toBeDefined()
  })
})
