import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mountWithI18n } from '../../../helpers/i18n'
import OrchestratorConfigDialog from '@/features/pipeline-editor/components/OrchestratorConfigDialog.vue'

// T8eb14482 — TC-UI-02/03/04/05/08: dialog cấu hình orchestrator (system_prompt
// tự do + multi-select knowledge qua `KnowledgePickerDialog` dùng chung).

vi.mock('@/features/knowledge/scripts/knowledgeApi', () => ({
  fetchKnowledgeList: vi.fn(async () => ({
    entries: [
      { id: 'project/a', title: 'A', scope: 'project', tags: [] },
      { id: 'project/b', title: 'B', scope: 'project', tags: [] },
    ],
  })),
}))

function mountDialog(orchestrator: Record<string, unknown> | null = null) {
  return mountWithI18n(OrchestratorConfigDialog, {
    props: { orchestrator, projectId: null },
    // Teleport đẩy nội dung ra <body> — stub để assert ngay trên wrapper,
    // cùng khuôn StepConfigDialog.test.ts.
    global: { stubs: { Teleport: true } },
  })
}

beforeEach(() => vi.clearAllMocks())

describe('OrchestratorConfigDialog', () => {
  it('TC-UI-02: render như một modal dialog đúng hợp đồng .modal / .modal-body', () => {
    const w = mountDialog()
    const modal = w.find('.modal.orchestrator-config-dialog')
    expect(modal.exists()).toBe(true)
    expect(modal.attributes('role')).toBe('dialog')
    expect(modal.attributes('aria-modal')).toBe('true')
    expect(w.findAll('.modal-body')).toHaveLength(1)
    expect(w.find('textarea.cfg-textarea').exists()).toBe(true)
  })

  it('TC-UI-03: chưa từng cấu hình gì ⇒ textarea rỗng, không có knowledge nào được chọn sẵn', () => {
    const w = mountDialog(null)
    expect((w.find('textarea.cfg-textarea').element as HTMLTextAreaElement).value).toBe('')
    expect(w.findAll('.tag-row .chip')).toHaveLength(0)
  })

  it('TC-UI-03: đã có system_prompt/knowledge_inputs từ trước ⇒ hiển thị đúng khi mở lại', () => {
    const w = mountDialog({
      system_prompt: 'Review có PO thì quay lại implementer.',
      knowledge_inputs: ['project/a', 'project/b'],
    })
    expect((w.find('textarea.cfg-textarea').element as HTMLTextAreaElement).value).toBe(
      'Review có PO thì quay lại implementer.',
    )
    const chips = w.findAll('.tag-row .chip')
    expect(chips.map((c) => c.text())).toEqual(['project/a ✕', 'project/b ✕'])
  })

  it('TC-UI-04: sửa textarea + bỏ chọn 1 knowledge rồi Apply ⇒ emit update đúng patch', async () => {
    const w = mountDialog({
      system_prompt: 'cũ',
      knowledge_inputs: ['project/a', 'project/b'],
    })
    await w.find('textarea.cfg-textarea').setValue('mới')
    // Bỏ chọn 'project/a' bằng cách click chip (removeKnowledgeInput).
    await w.findAll('.tag-row .chip')[0].trigger('click')
    await w.find('.btn-primary').trigger('click')

    expect(w.emitted('update')).toHaveLength(1)
    expect(w.emitted('update')![0][0]).toEqual({
      system_prompt: 'mới',
      knowledge_inputs: ['project/b'],
    })
  })

  it('TC-UI-04 edge case: bỏ chọn hết knowledge ⇒ Apply với danh sách rỗng, không lỗi', async () => {
    const w = mountDialog({ system_prompt: 'x', knowledge_inputs: ['project/a'] })
    await w.findAll('.tag-row .chip')[0].trigger('click')
    await w.find('.btn-primary').trigger('click')
    expect(w.emitted('update')![0][0]).toEqual({ system_prompt: 'x', knowledge_inputs: [] })
  })

  it('TC-UI-05: Huỷ (Cancel) và ✕ đóng dialog mà KHÔNG lưu, không emit update', async () => {
    const w = mountDialog({ system_prompt: 'giữ nguyên', knowledge_inputs: [] })
    await w.find('textarea.cfg-textarea').setValue('nháp bị bỏ')
    await w.find('.modal-actions .btn-ghost').trigger('click')
    await w.find('.modal-close').trigger('click')
    expect(w.emitted('close')).toHaveLength(2)
    expect(w.emitted('update')).toBeUndefined()
  })

  it('TC-UI-05: click backdrop đóng dialog không lưu', async () => {
    const w = mountDialog({ system_prompt: 'giữ nguyên', knowledge_inputs: [] })
    await w.find('.modal-backdrop').trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
    expect(w.emitted('update')).toBeUndefined()
  })

  it('TC-UI-05: Escape đóng dialog khi picker con KHÔNG mở', async () => {
    const w = mountDialog()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await w.vm.$nextTick()
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('TC-UI-05 edge case: picker con đang mở ⇒ Escape chỉ đóng picker, dialog cha KHÔNG đóng', async () => {
    const w = mountDialog()
    await w.find('.btn-ghost.btn-sm').trigger('click') // mở KnowledgePickerDialog
    expect(w.find('.knowledge-picker').exists()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await w.vm.$nextTick()

    expect(w.emitted('close')).toBeUndefined()
    expect(w.find('.knowledge-picker').exists()).toBe(false)
  })

  it('TC-UI-08: chọn nhiều knowledge qua picker rồi bỏ chọn 1 mục ⇒ danh sách phản ánh đúng, không trùng/sót', async () => {
    const w = mountDialog({ system_prompt: '', knowledge_inputs: [] })
    await w.find('.btn-ghost.btn-sm').trigger('click')

    function rows() {
      return w.findAll('.knowledge-picker-row input[type="checkbox"]')
    }
    expect(rows()).toHaveLength(2)
    await rows()[0].setValue(true)
    await rows()[1].setValue(true)
    expect(w.findAll('.tag-row .chip').map((c) => c.text())).toEqual(['project/a ✕', 'project/b ✕'])

    await rows()[0].setValue(false)
    expect(w.findAll('.tag-row .chip').map((c) => c.text())).toEqual(['project/b ✕'])
  })

  it('rebuilds the draft when the orchestrator prop changes', async () => {
    const w = mountDialog({ system_prompt: 'a', knowledge_inputs: ['project/a'] })
    await w.setProps({ orchestrator: { system_prompt: 'b', knowledge_inputs: [] } })
    expect((w.find('textarea.cfg-textarea').element as HTMLTextAreaElement).value).toBe('b')
    expect(w.findAll('.tag-row .chip')).toHaveLength(0)
  })
})
