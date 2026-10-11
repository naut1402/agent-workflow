import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'
import { mountWithI18n } from '../../../helpers/i18n'

/**
 * T6 — TC-B1…TC-B8 của `test-spec.md` §9.
 *
 * `BuilderChatBody` gọi thẳng `useNlChatSession()` nên không có prop nào để đẩy
 * state vào. Thay vì lái bằng mạng (đã có T3 phủ), ở đây thay cả composable bằng
 * một bản điều khiển được: cái cần chấm là **cấu trúc màn gộp** và **nối dây**
 * giữa `DraftEditor` và composable, không phải state machine của chat.
 *
 * 🚫 `taskDraftFields` / `draftPrompt` KHÔNG bị mock — đó là hàm thuần cùng
 * feature, mock đi là mất đúng thứ TC-B8 đang chấm.
 */

let session: any

vi.mock('@/features/nl-chat/composables/useNlChatSession', () => ({
  useNlChatSession: () => session,
}))

import BuilderChatBody from '@/features/nl-chat/components/BuilderChatBody.vue'
import DraftEditor from '@/features/nl-chat/components/DraftEditor.vue'

function makeSession(over: Record<string, unknown> = {}) {
  return {
    step: ref('chatting'),
    entityType: ref(null),
    messages: ref([{ role: 'user', text: 'tạo task' }]),
    draft: shallowRef(null),
    draftUpdatedByChat: ref(false),
    draftAttachWarning: ref(false),
    pipelineName: ref(''),
    agentScope: ref('project'),
    sending: ref(false),
    confirming: ref(false),
    error: ref(null),
    showLongChatNudge: ref(false),
    catalogAgentIds: ref(null),
    catalogError: ref(null),
    catalogProfileNames: ref(null),
    profileError: ref(null),
    loadingProfiles: ref(false),
    sendMessage: vi.fn(),
    setDraft: vi.fn(),
    undoDraftUpdate: vi.fn(),
    dismissDraftUpdate: vi.fn(),
    loadProfiles: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
    findInvalidPipelineAgentRefs: vi.fn(() => []),
    profileNameError: vi.fn(() => null),
    ...over,
  }
}

/** Phiên đang ở bước preview với một draft task sẵn sàng. */
function previewSession(draft: Record<string, unknown> = { prompt: 'p', name: 'a' }) {
  const s = makeSession()
  s.step.value = 'previewDraft'
  s.entityType.value = 'task'
  s.draft.value = draft
  s.catalogProfileNames.value = new Set(['rev'])
  return s
}

const mounted: { unmount: () => void }[] = []

function mountBody() {
  const wrapper = mountWithI18n(BuilderChatBody, { props: { projectId: 'P1' } })
  mounted.push(wrapper)
  return wrapper
}

beforeEach(() => {
  session = makeSession()
  // Không lượt mount nào được chạm mạng; gọi tới đây là test đang chấm nhầm thứ.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any) => {
      throw new Error(`unexpected fetch: ${String(input)}`)
    }),
  )
})

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
  vi.unstubAllGlobals()
})

describe('BuilderChatBody — màn gộp hội thoại + draft + composer', () => {
  it('TC-B1: ở previewDraft render CẢ hội thoại lẫn ô chat', () => {
    session = previewSession()
    const wrapper = mountBody()

    expect(wrapper.find('.nl-chat-messages').exists()).toBe(true)
    expect(wrapper.find('.nl-chat-input-row').exists()).toBe(true)
    expect(wrapper.find('.nl-chat-preview').exists()).toBe(true)
  })

  it('TC-B1b: các bước khác không hồi quy', () => {
    for (const step of ['chatting', 'done'] as const) {
      session = makeSession()
      session.step.value = step
      const wrapper = mountBody()

      expect(wrapper.find('.nl-chat-messages').exists(), step).toBe(true)
      expect(wrapper.find('.nl-chat-input-row').exists(), step).toBe(true)
    }
  })

  it('TC-B7: locator ô chat khớp ĐÚNG 1 phần tử ở cả hai view', async () => {
    session = previewSession()
    const wrapper = mountBody()

    const assertOneComposer = (label: string) => {
      expect(wrapper.findAll('.nl-chat-input-row textarea'), label).toHaveLength(1)
      // Textarea của draft/form không được nằm trong hàng composer, nếu không
      // locator `strict mode` của Playwright khớp nhiều phần tử và E2E đỏ.
      expect(wrapper.findAll('.nl-chat-input-row .nl-chat-draft-textarea'), label).toHaveLength(0)
      expect(
        wrapper.findAll('.nl-chat-input-row .nl-chat-draft-form textarea'),
        label,
      ).toHaveLength(0)
    }

    assertOneComposer('JSON view')
    expect(wrapper.find('.nl-chat-draft-textarea').exists()).toBe(true)

    const formBtn = wrapper
      .findAll('.nl-chat-view-toggle button')
      .find((b) => b.text() === 'Form view')!
    await formBtn.trigger('click')

    expect(wrapper.find('.nl-chat-draft-form').exists()).toBe(true)
    assertOneComposer('Form view')
  })
})

describe('BuilderChatBody — guard Xác nhận và confirm (TC-B2, TC-B3)', () => {
  function confirmBtn(wrapper: any) {
    return wrapper
      .findAll('.nl-chat-preview-actions button')
      .find((b: any) => b.text() === 'Xác nhận & tạo')!
  }

  it('TC-B2a: editorError chặn Xác nhận', async () => {
    session = previewSession()
    const wrapper = mountBody()
    await wrapper.findComponent(DraftEditor).vm.$emit('update:editorError', 'JSON hỏng')
    await wrapper.vm.$nextTick()

    expect(confirmBtn(wrapper).attributes('disabled')).toBeDefined()
  })

  it('TC-B2b: hết lỗi ⇒ bật lại', async () => {
    session = previewSession()
    const wrapper = mountBody()
    await wrapper.findComponent(DraftEditor).vm.$emit('update:editorError', 'JSON hỏng')
    await wrapper.findComponent(DraftEditor).vm.$emit('update:editorError', null)
    await wrapper.vm.$nextTick()

    expect(confirmBtn(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('TC-B3: confirm dùng ĐÚNG object draft đang hiển thị, không parse chuỗi', async () => {
    const draft = { prompt: 'p', name: 'a' }
    session = previewSession(draft)
    const wrapper = mountBody()
    await confirmBtn(wrapper).trigger('click')

    expect(session.confirm).toHaveBeenCalledTimes(1)
    expect(session.confirm.mock.calls[0][0]).toBe(draft)
  })
})

describe('BuilderChatBody — thu gọn hội thoại (TC-B4)', () => {
  it('TC-B4a: thu gọn giữ phần tử trong DOM, chỉ đổi class', async () => {
    session = previewSession()
    const wrapper = mountBody()
    await wrapper.find('.nl-chat-convo-bar button').trigger('click')

    const messages = wrapper.find('.nl-chat-messages')
    expect(messages.exists()).toBe(true)
    expect(messages.classes()).toContain('nl-chat-messages--hidden')
  })

  it('TC-B4b: nhãn + a11y của nút thu gọn đổi theo trạng thái', async () => {
    session = previewSession()
    const wrapper = mountBody()
    const btn = wrapper.find('.nl-chat-convo-bar button')

    expect(btn.attributes('aria-expanded')).toBe('true')
    expect(btn.attributes('title')).toBe('Thu gọn hội thoại')
    expect(btn.attributes('aria-label')).toBe('Thu gọn hội thoại')

    await btn.trigger('click')

    expect(btn.attributes('aria-expanded')).toBe('false')
    expect(btn.attributes('title')).toBe('Mở lại hội thoại')
    expect(btn.attributes('aria-label')).toBe('Mở lại hội thoại')
  })
})

describe('BuilderChatBody — composer và nối dây (TC-B5, TC-B6, TC-B8)', () => {
  it('TC-B5: placeholder composer đổi theo bước', async () => {
    session = previewSession()
    const wrapper = mountBody()
    expect(wrapper.find('.nl-chat-input-row textarea').attributes('placeholder')).toBe(
      'Nhập yêu cầu sửa draft...',
    )

    session.step.value = 'chatting'
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.nl-chat-input-row textarea').attributes('placeholder')).toBe(
      'Nhập tin nhắn...',
    )
  })

  it('TC-B6: DraftEditor nối đúng vào composable', async () => {
    session = previewSession()
    const wrapper = mountBody()
    const editor = wrapper.findComponent(DraftEditor)

    const payload = { prompt: 'p', name: 'b' }
    await editor.vm.$emit('update:draft', payload)
    await editor.vm.$emit('undo')
    await editor.vm.$emit('dismiss-banner')
    await editor.vm.$emit('retry-profiles')

    expect(session.setDraft).toHaveBeenCalledTimes(1)
    expect(session.setDraft).toHaveBeenCalledWith(payload)
    expect(session.undoDraftUpdate).toHaveBeenCalledTimes(1)
    expect(session.dismissDraftUpdate).toHaveBeenCalledTimes(1)
    expect(session.loadProfiles).toHaveBeenCalledTimes(1)
  })

  it('TC-B8: trạng thái catalog truyền xuống đúng', async () => {
    session = previewSession()
    session.catalogProfileNames.value = null
    const wrapper = mountBody()

    expect(wrapper.findComponent(DraftEditor).props('profile').state).toBe('loading')

    session.catalogProfileNames.value = new Set(['rev'])
    session.profileError.value = 'Không tải được danh sách pipeline profile.'
    await wrapper.vm.$nextTick()

    expect(wrapper.findComponent(DraftEditor).props('profile').state).toBe('error')
  })
})
