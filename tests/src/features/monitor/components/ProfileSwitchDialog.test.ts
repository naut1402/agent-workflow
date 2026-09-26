import { mountWithI18n as mount } from '../../../helpers/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import ProfileSwitchDialog from '@/features/monitor/components/ProfileSwitchDialog.vue'
import { fetchPipelineProfiles, fetchPipelineProfile } from '@/features/pipeline-editor/scripts/ProfileManagerApi'
import { writePipelineConfig } from '@/features/pipeline-editor/scripts/pipelineEditorApi'

vi.mock('@/features/pipeline-editor/scripts/ProfileManagerApi', () => ({
  fetchPipelineProfiles: vi.fn(async () => ({ profiles: [{ name: 'dev' }, { name: 'qa' }] })),
  fetchPipelineProfile: vi.fn(async () => ({
    pipeline: { steps: [{ id: 'investigator', label: 'Investigate' }] },
  })),
}))

vi.mock('@/features/pipeline-editor/scripts/pipelineEditorApi', () => ({
  writePipelineConfig: vi.fn(async () => ({})),
}))

function mountDialog(props: Partial<{ taskId: string; projectId: string | null; hitlPending: boolean }> = {}) {
  return mount(ProfileSwitchDialog, {
    props: { taskId: 'T1', projectId: null, hitlPending: false, ...props },
    attachTo: document.body,
  })
}

async function selectProfile(name: string) {
  const select = document.body.querySelector('.modal select') as HTMLSelectElement
  select.value = name
  select.dispatchEvent(new Event('change'))
  await flushPromises()
}

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

describe('ProfileSwitchDialog', () => {
  it('TC-04: mount tải danh sách profile, select rỗng không tự chọn sẵn (D1)', async () => {
    const w = mountDialog({ taskId: 'T1', projectId: 'p1' })
    await flushPromises()

    expect(fetchPipelineProfiles).toHaveBeenCalledWith('p1')
    const options = [...document.body.querySelectorAll('.modal select option')].map((o) => (o as HTMLOptionElement).value)
    expect(options).toEqual(['', 'dev', 'qa'])
    expect((document.body.querySelector('.modal select') as HTMLSelectElement).value).toBe('')
    // Nút Áp dụng bị khoá khi chưa chọn gì.
    expect((document.body.querySelector('.modal .btn-primary') as HTMLButtonElement).disabled).toBe(true)
    w.unmount()
  })

  it('TC-05: chọn profile → load preview bước đầu', async () => {
    const w = mountDialog()
    await flushPromises()

    await selectProfile('dev')

    expect(fetchPipelineProfile).toHaveBeenCalledWith('dev', undefined)
    expect(document.body.textContent).toContain('Bước đầu: Investigate')
    expect((document.body.querySelector('.modal .btn-primary') as HTMLButtonElement).disabled).toBe(false)
    w.unmount()
  })

  it('TC-05: Áp dụng gọi writePipelineConfig("task", pipeline, taskId, projectId) và emit applied', async () => {
    const w = mountDialog({ taskId: 'T5', projectId: 'p9' })
    await flushPromises()
    await selectProfile('dev')

    const applyBtn = document.body.querySelector('.modal .btn-primary') as HTMLButtonElement
    applyBtn.click()
    await flushPromises()

    expect(writePipelineConfig).toHaveBeenCalledWith(
      'task',
      { steps: [{ id: 'investigator', label: 'Investigate' }] },
      'T5',
      'p9',
    )
    expect(w.emitted('applied')).toBeTruthy()
    w.unmount()
  })

  it('TC-06: Huỷ (không chọn/xác nhận) → không gọi writePipelineConfig, emit close', async () => {
    const w = mountDialog()
    await flushPromises()

    const cancelBtn = document.body.querySelector('.modal .btn-ghost') as HTMLButtonElement
    cancelBtn.click()
    await flushPromises()

    expect(writePipelineConfig).not.toHaveBeenCalled()
    expect(w.emitted('close')).toBeTruthy()
    expect(w.emitted('applied')).toBeFalsy()
    w.unmount()
  })

  it('TC-06: click ra ngoài backdrop cũng đóng dialog mà không ghi gì', async () => {
    const w = mountDialog()
    await flushPromises()
    await selectProfile('dev')

    const backdrop = document.body.querySelector('.modal-backdrop') as HTMLElement
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect(writePipelineConfig).not.toHaveBeenCalled()
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })

  it('TC-07: project chưa có profile nào → hiện thông báo rõ ràng, không cho chọn/xác nhận', async () => {
    vi.mocked(fetchPipelineProfiles).mockResolvedValueOnce({ profiles: [] })
    const w = mountDialog()
    await flushPromises()

    expect(document.body.textContent).toContain('Project chưa có pipeline profile nào.')
    expect(document.body.querySelector('.modal select')).toBeNull()
    expect((document.body.querySelector('.modal .btn-primary') as HTMLButtonElement).disabled).toBe(true)
    w.unmount()
  })

  it('TC-08: writePipelineConfig lỗi 400 → hiện lỗi inline, dialog không tự đóng, không emit applied', async () => {
    vi.mocked(writePipelineConfig).mockRejectedValueOnce({ status: 400 })
    const w = mountDialog()
    await flushPromises()
    await selectProfile('dev')

    const applyBtn = document.body.querySelector('.modal .btn-primary') as HTMLButtonElement
    applyBtn.click()
    await flushPromises()

    expect(document.body.textContent).toContain('Task đã archived hoặc hoàn tất — không thể ghi pipeline mới.')
    expect(document.body.querySelector('.modal')).not.toBeNull()
    expect(w.emitted('applied')).toBeFalsy()
    expect(w.emitted('close')).toBeFalsy()
    w.unmount()
  })

  it('lỗi khác 400 (vd network) hiện nguyên message, không map sang writeBlocked', async () => {
    vi.mocked(writePipelineConfig).mockRejectedValueOnce(new Error('network down'))
    const w = mountDialog()
    await flushPromises()
    await selectProfile('dev')

    const applyBtn = document.body.querySelector('.modal .btn-primary') as HTMLButtonElement
    applyBtn.click()
    await flushPromises()

    expect(document.body.textContent).toContain('network down')
    expect(document.body.textContent).not.toContain('Task đã archived hoặc hoàn tất')
    w.unmount()
  })

  it('D2: cảnh báo HITL chỉ hiện khi hitlPending=true VÀ đã chọn 1 profile', async () => {
    const w = mountDialog({ hitlPending: true })
    await flushPromises()

    expect(document.body.textContent).not.toContain('Task đang có gate HITL')
    await selectProfile('dev')
    expect(document.body.textContent).toContain('Task đang có gate HITL chờ duyệt — ghi đè pipeline sẽ huỷ gate đó.')
    w.unmount()
  })

  it('hitlPending=false + đã chọn profile → không hiện cảnh báo HITL', async () => {
    const w = mountDialog({ hitlPending: false })
    await flushPromises()
    await selectProfile('dev')

    expect(document.body.textContent).not.toContain('Task đang có gate HITL')
    w.unmount()
  })

  it('a11y: dialog có role="dialog" + aria-modal + aria-label đúng heading', async () => {
    const w = mountDialog()
    await flushPromises()

    const dialog = document.body.querySelector('.modal')
    expect(dialog?.getAttribute('role')).toBe('dialog')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.getAttribute('aria-label')).toBe('Đổi pipeline profile')
    w.unmount()
  })

  it('lỗi khi load danh sách profile → hiện lỗi, không crash', async () => {
    vi.mocked(fetchPipelineProfiles).mockRejectedValueOnce(new Error('boom'))
    const w = mountDialog()
    await flushPromises()

    expect(document.body.textContent).toContain('boom')
    w.unmount()
  })
})
