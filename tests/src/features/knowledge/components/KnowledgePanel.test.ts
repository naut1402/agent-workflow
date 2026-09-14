import { mountWithI18n as mount } from '../../../helpers/i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import KnowledgePanel from '@/features/knowledge/components/KnowledgePanel.vue'

/**
 * Panel sau khi đổi sang khuôn `left sub-menu + main`.
 *
 * Bất biến trọng tâm: **hai state tách hẳn nhau** — `viewingId` (entry hiện ở
 * `main`) và `editingId` (entry trong dialog). Trước đây bấm một dòng là mở
 * thẳng dialog, không có bề mặt nào đọc entry dạng markdown.
 */

const fetchKnowledgeList = vi.fn()
const fetchKnowledgeEntry = vi.fn()
const deleteKnowledgeEntry = vi.fn()
const fetchKnowledgeCollections = vi.fn()
const saveKnowledgeEntry = vi.fn()
const createKnowledgeEntry = vi.fn()

vi.mock('@/features/knowledge/scripts/KnowledgePanelApi', () => ({
  fetchKnowledgeList: (...a: unknown[]) => fetchKnowledgeList(...a),
  fetchKnowledgeEntry: (...a: unknown[]) => fetchKnowledgeEntry(...a),
  saveKnowledgeEntry: (...a: unknown[]) => saveKnowledgeEntry(...a),
  createKnowledgeEntry: (...a: unknown[]) => createKnowledgeEntry(...a),
  deleteKnowledgeEntry: (...a: unknown[]) => deleteKnowledgeEntry(...a),
  fetchKnowledgeCollections: (...a: unknown[]) => fetchKnowledgeCollections(...a),
  deleteKnowledgeCollection: vi.fn(),
  fetchKnowledgeBundle: vi.fn(async () => ({ bundle: [] })),
  uploadKnowledgeFile: vi.fn(),
  createKnowledgeCollection: vi.fn(),
  saveKnowledgeCollection: vi.fn(),
  createKnowledgeTag: vi.fn(),
  saveKnowledgeTag: vi.fn(),
  renameKnowledgeTag: vi.fn(),
}))

vi.mock('@/frontend/lib/markdownLib', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/frontend/lib/markdownLib')>()),
  renderMermaid: vi.fn(async () => {}),
}))

/** Stub nhẹ — 🚫 không dựng Toast UI Editor trong jsdom. */
const MarkdownTextEditorStub = defineComponent({
  name: 'MarkdownTextEditor',
  props: {
    modelValue: { type: String, default: '' },
    height: { type: String, default: '320px' },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () =>
      h('textarea', {
        class: 'mock-md-editor',
        'data-height': props.height,
        value: props.modelValue,
        onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLTextAreaElement).value),
      })
  },
})

const ALPHA = { id: 'project/alpha', slug: 'alpha', scope: 'project', title: 'Alpha', tags: ['x'] }
const BETA = { id: 'project/beta', slug: 'beta', scope: 'project', title: 'Beta', tags: [] }

async function mountPanel(props: Record<string, unknown> = {}) {
  const w = mount(KnowledgePanel, {
    props,
    global: { stubs: { MarkdownTextEditor: MarkdownTextEditorStub } },
  })
  await flushPromises()
  return w
}

const body = (w: Awaited<ReturnType<typeof mountPanel>>) => w.find('.c-screen-layout__body')
const rowIcons = (w: Awaited<ReturnType<typeof mountPanel>>, i: number) =>
  w.findAll('.knowledge-group')[0].findAll('.knowledge-list-item')[i].findAll('.icon-btn')

beforeEach(() => {
  vi.clearAllMocks()
  fetchKnowledgeList.mockResolvedValue({
    entries: [ALPHA, BETA],
    tags: [{ tag: 'x', count: 1, color: 'blue', description: '', scope: 'project' }],
  })
  fetchKnowledgeEntry.mockResolvedValue({
    entry: { ...ALPHA, content: '## Phần A\n\nnội dung alpha' },
  })
  fetchKnowledgeCollections.mockResolvedValue({ collections: [] })
  deleteKnowledgeEntry.mockResolvedValue({ deleted: true })
})

describe('KnowledgePanel — nạp danh sách', () => {
  it('neo `.knowledge-panel` nằm ở ROOT layout nên thấy được ngay cả khi main bị thu', async () => {
    const w = await mountPanel()
    // Neo phải ở chính gốc CScreenLayout: để trên `main` thì `hideMain` thu nó
    // về 0 và spec e2e chờ nó visible sẽ đỏ ngay lúc mở màn.
    expect(w.find('.knowledge-panel').exists()).toBe(true)
    expect(w.find('.knowledge-panel').classes()).toContain('c-screen-layout')
  })

  it('MỘT request mang cả entry lẫn facet tag (`include=tags`)', async () => {
    await mountPanel()
    expect(fetchKnowledgeList).toHaveBeenCalledTimes(1)
    expect(fetchKnowledgeList).toHaveBeenCalledWith(expect.objectContaining({ include: 'tags' }))
  })
})

describe('KnowledgePanel — ẩn/hiện main', () => {
  it('chưa chọn entry ⇒ --no-main bật, main hiện empty state', async () => {
    const w = await mountPanel()
    expect(body(w).classes()).toContain('c-screen-layout__body--no-main')
    expect(w.find('.knowledge-main-empty').text()).toContain('Chọn một entry')
  })

  it('icon eye mở VIEWER ở main, KHÔNG mở dialog', async () => {
    const w = await mountPanel()
    await rowIcons(w, 0)[0].trigger('click')
    await flushPromises()

    expect(fetchKnowledgeEntry).toHaveBeenCalledWith('project/alpha', undefined)
    expect(body(w).classes()).not.toContain('c-screen-layout__body--no-main')
    expect(w.find('.c-md-view').exists()).toBe(true)
    expect(w.text()).toContain('nội dung alpha')
    expect(w.find('.knowledge-form-dialog').exists()).toBe(false)
  })

  it('bấm tên entry cũng mở viewer', async () => {
    const w = await mountPanel()
    await w.findAll('.knowledge-group')[0].findAll('.knowledge-list-name')[0].trigger('click')
    await flushPromises()
    expect(w.find('.c-md-view').exists()).toBe(true)
  })

  /** Chỉ phần text — siêu dữ liệu (title/scope/tags) 🚫 không hiện trong viewer. */
  it('nội dung mở đầu bằng `---` KHÔNG bị tách thành block Metadata', async () => {
    fetchKnowledgeEntry.mockResolvedValue({
      entry: { ...ALPHA, content: '---\nđây là nội dung thật\n---\n\n## A\n\nbody' },
    })
    const w = await mountPanel()
    await rowIcons(w, 0)[0].trigger('click')
    await flushPromises()

    expect(w.findAll('.block-item summary').map((s) => s.text())).not.toContain('Metadata')
    expect(w.text()).toContain('đây là nội dung thật')
  })

  it('dòng đang xem được đánh dấu active', async () => {
    const w = await mountPanel()
    await rowIcons(w, 0)[0].trigger('click')
    await flushPromises()
    expect(w.findAll('.knowledge-group')[0].findAll('.knowledge-list-item')[0].classes()).toContain('active')
  })
})

describe('KnowledgePanel — icon pencil mở dialog', () => {
  it('mở dialog sửa mà KHÔNG đụng viewer', async () => {
    const w = await mountPanel()
    await rowIcons(w, 0)[1].trigger('click')
    await flushPromises()

    expect(w.find('.knowledge-form-dialog').exists()).toBe(true)
    // Viewer vẫn trống: sửa và xem là hai state độc lập.
    expect(w.find('.c-md-view').exists()).toBe(false)
    expect(body(w).classes()).toContain('c-screen-layout__body--no-main')
  })

  it('dialog sửa KHÔNG còn ô slug và KHÔNG còn nút Xóa', async () => {
    const w = await mountPanel()
    await rowIcons(w, 0)[1].trigger('click')
    await flushPromises()

    const dialog = w.find('.knowledge-form-dialog')
    expect(dialog.text()).not.toContain('Slug')
    expect(dialog.find('.btn-danger').exists()).toBe(false)
  })

  it('`Lưu` đứng TRƯỚC `Hủy` ở chân dialog', async () => {
    const w = await mountPanel()
    await rowIcons(w, 0)[1].trigger('click')
    await flushPromises()

    const labels = w.find('.modal-foot').findAll('button').map((b) => b.text())
    expect(labels).toEqual(['Lưu', 'Hủy'])
  })

  it('lưu KHÔNG gửi trường `slug` — slug là phần nội suy', async () => {
    saveKnowledgeEntry.mockResolvedValue({ entry: ALPHA })
    const w = await mountPanel()
    await rowIcons(w, 0)[1].trigger('click')
    await flushPromises()
    await w.find('.modal-foot .btn-primary').trigger('click')
    await flushPromises()

    expect(saveKnowledgeEntry).toHaveBeenCalled()
    expect(saveKnowledgeEntry.mock.calls[0][1]).not.toHaveProperty('slug')
  })

  it('vẫn dựng MarkdownTextEditor và bind draft.content qua v-model', async () => {
    const w = await mountPanel()
    await rowIcons(w, 0)[1].trigger('click')
    await flushPromises()

    const editor = w.find('.mock-md-editor')
    expect(editor.attributes('data-height')).toBe('400px')
    await editor.setValue('# Hello knowledge')
    await flushPromises()
    expect((w.vm as unknown as { draft: { content: string } }).draft.content).toBe('# Hello knowledge')
  })
})

describe('KnowledgePanel — xoá entry từ hàng danh sách', () => {
  it('hủy confirm ⇒ không gọi API xoá', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const w = await mountPanel()
    await rowIcons(w, 0)[3].trigger('click')
    await flushPromises()
    expect(deleteKnowledgeEntry).not.toHaveBeenCalled()
  })

  // Xoá entry đang xem ⇒ main thu về 0, cột trái chiếm full width (E6).
  it('xoá entry ĐANG XEM ⇒ main về empty state, --no-main bật lại', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const w = await mountPanel()
    await rowIcons(w, 0)[0].trigger('click')
    await flushPromises()
    expect(w.find('.c-md-view').exists()).toBe(true)

    fetchKnowledgeList.mockResolvedValue({ entries: [BETA], tags: [] })
    await rowIcons(w, 0)[3].trigger('click')
    await flushPromises()

    expect(deleteKnowledgeEntry).toHaveBeenCalledWith('project/alpha', undefined)
    expect(w.find('.c-md-view').exists()).toBe(false)
    expect(body(w).classes()).toContain('c-screen-layout__body--no-main')
  })

  it('xoá entry KHÁC entry đang xem ⇒ main giữ nguyên', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const w = await mountPanel()
    await rowIcons(w, 0)[0].trigger('click')
    await flushPromises()

    fetchKnowledgeList.mockResolvedValue({ entries: [ALPHA], tags: [] })
    await rowIcons(w, 1)[3].trigger('click')
    await flushPromises()

    expect(deleteKnowledgeEntry).toHaveBeenCalledWith('project/beta', undefined)
    expect(w.find('.c-md-view').exists()).toBe(true)
    expect(w.text()).toContain('nội dung alpha')
  })
})

describe('KnowledgePanel — lỗi đọc collection/tag', () => {
  /**
   * E1 — DB hỏng: danh sách knowledge đọc từ file nên vẫn sống; phần nhóm hiện
   * lỗi và 🚫 không được hiện thành "chưa có nhóm nào" (người dùng sẽ tạo mới
   * và đè mất dữ liệu cũ).
   */
  it('hiện lỗi và khoá đường ghi nhóm, danh sách entry vẫn liệt kê', async () => {
    fetchKnowledgeCollections.mockRejectedValue(new Error('không mở được dashboard.sqlite'))
    const w = await mountPanel()

    expect(w.find('.knowledge-side-error').text()).toContain('dashboard.sqlite')
    expect(w.findAll('.knowledge-group')[0].findAll('.knowledge-list-item')).toHaveLength(2)
    for (const add of w.findAll('.knowledge-group-add')) {
      expect(add.attributes('disabled')).toBeDefined()
    }
  })
})

describe('KnowledgePanel — đổi project', () => {
  it('reset entry đang xem và nạp lại cả hai nguồn', async () => {
    const w = await mountPanel({ projectId: 'p1' })
    await rowIcons(w, 0)[0].trigger('click')
    await flushPromises()
    expect(w.find('.c-md-view').exists()).toBe(true)

    vi.clearAllMocks()
    fetchKnowledgeList.mockResolvedValue({ entries: [], tags: [] })
    fetchKnowledgeCollections.mockResolvedValue({ collections: [] })
    await w.setProps({ projectId: 'p2' })
    await flushPromises()

    expect(w.find('.c-md-view').exists()).toBe(false)
    expect(fetchKnowledgeList).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p2' }))
    expect(fetchKnowledgeCollections).toHaveBeenCalledWith('p2')
  })
})
