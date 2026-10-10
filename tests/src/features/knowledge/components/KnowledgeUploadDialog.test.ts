import { mountWithI18n as mount } from '../../../helpers/i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import KnowledgeUploadDialog from '@/features/knowledge/components/KnowledgeUploadDialog.vue'

const uploadKnowledgeFile = vi.fn()

vi.mock('@/features/knowledge/scripts/KnowledgePanelApi', () => ({
  uploadKnowledgeFile: (...a: unknown[]) => uploadKnowledgeFile(...a),
}))

function hold<T>() {
  let release!: (v: T) => void
  let fail!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    release = res
    fail = rej
  })
  return { promise, release, fail }
}

function pickFile(input: HTMLInputElement, name = 'note.md') {
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File(['# note'], name, { type: 'text/markdown' })],
  })
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

const mountDialog = () => mount(KnowledgeUploadDialog, { props: { projectId: 'p1' }, attachTo: document.body })

beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

describe('KnowledgeUploadDialog — upload chặn thao tác khi đang chạy', () => {
  it('TC-37: đang upload → overlay neo ngoài hộp cuộn, input khoá, chọn lại file không gửi request thứ hai', async () => {
    const pending = hold<{ entry: { id: string } }>()
    uploadKnowledgeFile.mockReturnValueOnce(pending.promise)
    const w = mountDialog()
    const input = w.find('input[type="file"]').element as HTMLInputElement

    const host = w.find('.c-loading-host')
    expect(host.exists()).toBe(true)
    expect(host.find('.modal-body.knowledge-upload-body').exists()).toBe(true)

    pickFile(input)
    await nextTick()
    expect(host.find('.c-loading-overlay').exists()).toBe(true)
    expect(input.disabled).toBe(true)

    pickFile(input, 'other.md')
    await nextTick()
    expect(uploadKnowledgeFile).toHaveBeenCalledTimes(1)

    pending.release({ entry: { id: 'e1' } })
    await flushPromises()
    expect(w.emitted('uploaded')?.[0]).toEqual(['e1'])
    expect(host.find('.c-loading-overlay').exists()).toBe(false)
    expect(input.disabled).toBe(false)
  })

  it('TC-38: upload lỗi → hiện lỗi, nhả cờ bận và reset input để chọn lại đúng file đó', async () => {
    const pending = hold<{ entry: { id: string } }>()
    uploadKnowledgeFile.mockReturnValueOnce(pending.promise)
    const w = mountDialog()
    const input = w.find('input[type="file"]').element as HTMLInputElement
    input.value = ''
    const setValue = vi.spyOn(input, 'value', 'set')

    pickFile(input)
    await nextTick()
    pending.fail(new Error('file quá lớn'))
    await flushPromises()

    expect(w.find('.err').text()).toContain('file quá lớn')
    expect(w.find('.c-loading-overlay').exists()).toBe(false)
    expect(input.disabled).toBe(false)
    expect(setValue).toHaveBeenCalledWith('')
    expect(w.emitted('uploaded')).toBeUndefined()
  })

  it('TC-39: gửi đúng scope, tag đã tách và projectId', async () => {
    uploadKnowledgeFile.mockResolvedValueOnce({ entry: { id: 'e2' } })
    const w = mountDialog()
    await w.find('select').setValue('system')
    await w.find('input.cfg-input').setValue(' pipeline ; vue,, ')

    pickFile(w.find('input[type="file"]').element as HTMLInputElement)
    await flushPromises()

    expect(uploadKnowledgeFile).toHaveBeenCalledTimes(1)
    const [file, opts] = uploadKnowledgeFile.mock.calls[0]
    expect((file as File).name).toBe('note.md')
    expect(opts).toEqual({ scope: 'system', tags: ['pipeline', 'vue'], projectId: 'p1' })
  })
})
