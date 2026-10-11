import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountWithI18n as mount } from '../../../helpers/i18n'
import KnowledgeCollectionDialog from '@/features/knowledge/components/KnowledgeCollectionDialog.vue'
import { localeMessages } from '../../../helpers/localeYaml'

const knowledgeVi = localeMessages('vi', 'knowledge')

/**
 * TC-26 — đây là chỗ DUY NHẤT trong repo từng có guard chống bấm lặp viết tay
 * (`if (… || saving.value) return`), và công thức migrate bảo xoá vế đó để guard
 * của `useApiAction` thay thế. Xoá một guard đang hoạt động ở một file không có
 * test nào là thay đổi duy nhất trong PR không có lưới nào đỡ — file này là lưới.
 */

vi.mock('@/features/knowledge/scripts/KnowledgePanelApi', () => ({
  fetchKnowledgeList: vi.fn(async () => ({ entries: [] })),
  createKnowledgeCollection: vi.fn(async () => ({ collection: { id: 'col-1' } })),
  saveKnowledgeCollection: vi.fn(async () => ({ collection: { id: 'col-1' } })),
}))

import { createKnowledgeCollection } from '@/features/knowledge/scripts/KnowledgePanelApi'

/** Cổng mở bằng tay — giữ request lưu treo mà không cần fake timer. */
function gate() {
  let release!: () => void
  const p = new Promise<void>((r) => {
    release = r
  })
  return { wait: () => p, release }
}

const OVERLAY = '.c-loading-overlay'

async function mountDialog() {
  const w = mount(KnowledgeCollectionDialog, {
    props: { collection: null, tags: [], projectId: 'p1' },
    global: { stubs: { teleport: true } },
  })
  await flushPromises()
  return w
}

function saveButton(w: Awaited<ReturnType<typeof mountDialog>>) {
  const btn = w.findAll('.modal-foot button').find((b) => b.text() === knowledgeVi.actions.save)
  if (!btn) throw new Error('save button not found')
  return btn
}

async function fillName(w: Awaited<ReturnType<typeof mountDialog>>, value: string) {
  await w.findAll('input.cfg-input')[0].setValue(value)
}

afterEach(() => {
  vi.mocked(createKnowledgeCollection).mockReset()
  vi.mocked(createKnowledgeCollection).mockImplementation(async () => ({ collection: { id: 'col-1' } }) as any)
})

describe('KnowledgeCollectionDialog — chống bấm lặp khi lưu', () => {
  it('TC-26: bấm Lưu hai lần liên tiếp chỉ gọi API một lần', async () => {
    const g = gate()
    vi.mocked(createKnowledgeCollection).mockImplementation(async () => {
      await g.wait()
      return { collection: { id: 'col-1' } } as any
    })

    const w = await mountDialog()
    await fillName(w, 'Nhóm A')

    const btn = saveButton(w).element
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(createKnowledgeCollection).toHaveBeenCalledTimes(1)
    expect(saveButton(w).attributes('disabled')).toBeDefined()
    expect(w.find(OVERLAY).exists()).toBe(true)

    g.release()
    await flushPromises()
    expect(w.emitted('saved')?.[0]).toEqual(['col-1', true])
  })

  it('TC-26: tên rỗng thì không gọi API và KHÔNG bật `pending`', async () => {
    const w = await mountDialog()

    // Vế validate của guard cũ phải sống sót nguyên vẹn. Xoá nhầm cả vế đó, hoặc
    // bọc `run` ra NGOÀI vế validate, đều làm cờ bật cho một lần bấm không gửi
    // request nào — nút kẹt disabled mà người dùng không hiểu vì sao.
    await saveButton(w).trigger('click')
    await flushPromises()

    expect(createKnowledgeCollection).not.toHaveBeenCalled()
    expect(w.find(OVERLAY).exists()).toBe(false)
    // Nút vẫn disabled, nhưng vì tên rỗng — không phải vì cờ đang bận.
    await fillName(w, 'Nhóm A')
    expect(saveButton(w).attributes('disabled')).toBeUndefined()
  })

  it('TC-26: API lỗi thì overlay tắt, nút mở lại và bấm lại gửi request mới', async () => {
    vi.mocked(createKnowledgeCollection).mockRejectedValueOnce(new Error('409 Conflict'))

    const w = await mountDialog()
    await fillName(w, 'Nhóm A')
    await saveButton(w).trigger('click')
    await flushPromises()

    expect(w.find(OVERLAY).exists()).toBe(false)
    expect(w.find('.err').text()).toContain('409 Conflict')
    expect(saveButton(w).attributes('disabled')).toBeUndefined()

    await saveButton(w).trigger('click')
    await flushPromises()
    expect(createKnowledgeCollection).toHaveBeenCalledTimes(2)
  })
})
