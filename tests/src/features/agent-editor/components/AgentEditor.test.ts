import { mountWithI18n as mount } from '../../../helpers/i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import AgentEditor from '@/features/agent-editor/components/AgentEditor.vue'

const fetchCustomAgents = vi.fn()
const fetchCustomAgent = vi.fn()
const deleteCustomAgent = vi.fn()

vi.mock('@/features/agent-editor/scripts/agentEditorApi', () => ({
  fetchCustomAgents: (...a: unknown[]) => fetchCustomAgents(...a),
  fetchCustomAgent: (...a: unknown[]) => fetchCustomAgent(...a),
  deleteCustomAgent: (...a: unknown[]) => deleteCustomAgent(...a),
  saveCustomAgent: vi.fn(),
}))

vi.mock('@/features/pipeline-editor/scripts/pipelineEditorApi', () => ({
  fetchCatalog: vi.fn(async () => ({ skills: [], agents: [] })),
}))

vi.mock('@/frontend/lib/markdownLib', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/frontend/lib/markdownLib')>()),
  renderMermaid: vi.fn(async () => {}),
}))

const ALPHA = { name: 'alpha', scope: 'project' as const, editable: true }
const BETA = { name: 'beta', scope: 'project' as const, editable: true }

const stubs = {
  AgentFormDialog: { template: '<div class="stub-dialog" />', props: ['agent', 'initialDraft'] },
}

async function mountEditor(props: Record<string, unknown> = {}) {
  const w = mount(AgentEditor, { props, global: { stubs } })
  await flushPromises()
  return w
}

const body = (w: Awaited<ReturnType<typeof mountEditor>>) => w.find('.c-screen-layout__body')
const rowIcons = (w: Awaited<ReturnType<typeof mountEditor>>, i: number) =>
  w.findAll('.agent-list-item')[i].findAll('.icon-btn')

beforeEach(() => {
  vi.clearAllMocks()
  fetchCustomAgents.mockResolvedValue({ agents: [ALPHA, BETA] })
  fetchCustomAgent.mockImplementation(async (name: string) => ({
    name,
    content: `## Role\n\nnội dung ${name}`,
  }))
  deleteCustomAgent.mockResolvedValue({})
  // jsdom không cài createObjectURL/revokeObjectURL — cần stub cho luồng download.
  URL.createObjectURL = vi.fn(() => 'blob:mock-url')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

describe('AgentEditor — toolbar dọn sạch (TC-A1, TC-A3)', () => {
  it('không còn nút Template/Sao chép, Tạo từ mô tả, Export ở toolbar, kể cả khi đang xem agent', async () => {
    const w = await mountEditor()
    await w.findAll('.agent-list-name')[0].trigger('click')
    await flushPromises()

    const texts = w.findAll('.agent-side-actions button').map((b) => b.text())
    for (const forbidden of ['Template / Sao chép', 'Tạo từ mô tả', 'Export', 'Download']) {
      expect(texts.join(' | ')).not.toContain(forbidden)
    }
    expect(w.findAll('.agent-side-actions button')).toHaveLength(2)
  })
})

describe('AgentEditor — ẩn/hiện main (TC-01, TC-02, TC-03)', () => {
  it('chưa chọn agent ⇒ --no-main bật, main hiện empty state', async () => {
    const w = await mountEditor()
    expect(body(w).classes()).toContain('c-screen-layout__body--no-main')
    expect(w.find('.agent-main-empty').text()).toContain('Chọn một agent')
  })

  it('chọn agent ⇒ nạp content, tắt --no-main, hiện viewer', async () => {
    const w = await mountEditor()
    await w.findAll('.agent-list-name')[0].trigger('click')
    await flushPromises()

    expect(fetchCustomAgent).toHaveBeenCalledWith('alpha', undefined, 'project')
    expect(body(w).classes()).not.toContain('c-screen-layout__body--no-main')
    expect(w.find('.c-md-view').exists()).toBe(true)
    expect(w.text()).toContain('nội dung alpha')
  })

  it('dòng đang xem được đánh dấu active', async () => {
    const w = await mountEditor()
    await w.findAll('.agent-list-name')[0].trigger('click')
    await flushPromises()
    expect(w.findAll('.agent-list-item')[0].classes()).toContain('active')
  })
})

describe('AgentEditor — xoá agent (TC-E1, E2, E3)', () => {
  it('hủy confirm ⇒ không gọi API xoá', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const w = await mountEditor()
    await rowIcons(w, 0).at(-1)?.trigger('click')
    await flushPromises()
    expect(deleteCustomAgent).not.toHaveBeenCalled()
  })

  // E2: xoá đúng agent đang xem ⇒ main phải về rỗng, không giữ nội dung cũ.
  it('xoá agent đang xem ⇒ main về empty state, --no-main bật lại', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const w = await mountEditor()
    await w.findAll('.agent-list-name')[0].trigger('click')
    await flushPromises()
    expect(w.find('.c-md-view').exists()).toBe(true)

    fetchCustomAgents.mockResolvedValue({ agents: [BETA] })
    await rowIcons(w, 0).at(-1)?.trigger('click')
    await flushPromises()

    expect(deleteCustomAgent).toHaveBeenCalledWith('alpha', undefined, 'project')
    expect(w.find('.c-md-view').exists()).toBe(false)
    expect(body(w).classes()).toContain('c-screen-layout__body--no-main')
    expect(w.text()).not.toContain('nội dung alpha')
  })

  it('xoá agent KHÁC agent đang xem ⇒ main giữ nguyên', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const w = await mountEditor()
    await w.findAll('.agent-list-name')[0].trigger('click')
    await flushPromises()

    fetchCustomAgents.mockResolvedValue({ agents: [ALPHA] })
    await rowIcons(w, 1).at(-1)?.trigger('click')
    await flushPromises()

    expect(w.find('.c-md-view').exists()).toBe(true)
    expect(w.text()).toContain('nội dung alpha')
  })

  // TC-E1: xoá lỗi ⇒ báo lỗi đọc được, agent vẫn còn.
  it('xoá thất bại ⇒ hiện lỗi, danh sách không mất mục', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    deleteCustomAgent.mockRejectedValue(new Error('EACCES: khoá file'))
    const w = await mountEditor()
    await rowIcons(w, 0).at(-1)?.trigger('click')
    await flushPromises()

    expect(w.find('.err').text()).toContain('EACCES')
    expect(w.findAll('.agent-list-item')).toHaveLength(2)
  })
})

describe('AgentEditor — Download mỗi item (TC-B2, TC-B3, TC-B4)', () => {
  it('TC-B2: tải đúng nội dung của item vừa bấm, không phụ thuộc agent đang xem', async () => {
    const w = await mountEditor()
    // Đang xem alpha ở panel chính…
    await w.findAll('.agent-list-name')[0].trigger('click')
    await flushPromises()
    expect(w.text()).toContain('nội dung alpha')

    // …nhưng bấm Download ở dòng beta.
    await rowIcons(w, 1)[0].trigger('click')
    await flushPromises()

    expect(fetchCustomAgent).toHaveBeenLastCalledWith('beta', undefined, 'project')
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as Blob
    await expect(blob.text()).resolves.toContain('nội dung beta')
    // Panel chính không đổi theo thao tác download.
    expect(w.text()).toContain('nội dung alpha')
  })

  // TC-B3 (edge): agent bị xoá ở nơi khác — download báo lỗi, không crash,
  // các item còn lại vẫn thao tác bình thường sau đó.
  it('TC-B3: download agent vừa bị xoá ở nơi khác ⇒ hiện lỗi, các item khác vẫn dùng được', async () => {
    fetchCustomAgent.mockRejectedValueOnce(new Error('ENOENT: alpha không còn tồn tại'))
    const w = await mountEditor()

    await rowIcons(w, 0)[0].trigger('click')
    await flushPromises()

    expect(w.find('.err').text()).toContain('ENOENT')
    expect(URL.createObjectURL).not.toHaveBeenCalled()

    // Item còn lại (beta) vẫn thao tác được bình thường.
    fetchCustomAgent.mockResolvedValueOnce({ name: 'beta', content: '## Role\n\nnội dung beta' })
    await rowIcons(w, 1)[0].trigger('click')
    await flushPromises()
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  })

  // TC-B4 (edge): hiển thị bất kể quyền chỉnh sửa — đã phủ ở AgentSideMenu.test.ts
  // (unit), ở đây xác nhận thêm handler thật sự chạy được trên item không editable.
  it('TC-B4: download hoạt động trên agent không editable', async () => {
    fetchCustomAgents.mockResolvedValue({ agents: [{ ...BETA, editable: false }] })
    const w = await mountEditor()
    await rowIcons(w, 0)[0].trigger('click')
    await flushPromises()
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  })
})

describe('AgentEditor — Upload icon-button (TC-C2)', () => {
  it('chọn file .md hợp lệ ⇒ mở form tạo mới với draft đọc từ file, hành vi như trước', async () => {
    const w = await mountEditor()
    const file = new File(['## Role\n\nnội dung từ file'], 'imported.md', { type: 'text/markdown' })
    const input = w.find('input[type="file"]').element as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [file], configurable: true })

    await w.find('input[type="file"]').trigger('change')
    await flushPromises()

    const dialog = w.findComponent(stubs.AgentFormDialog)
    expect(dialog.props('agent')).toBeNull()
    expect((dialog.props('initialDraft') as any).sections.role).toContain('nội dung từ file')
  })
})

describe('AgentEditor — sao chép agent mỗi item (TC-D2, TC-D3, TC-D5, TC-D6)', () => {
  it('TC-D2: bấm sao chép ⇒ mở form tạo mới, tên đề xuất là "<gốc>-copy", nội dung theo agent gốc', async () => {
    const w = await mountEditor()
    await rowIcons(w, 0)[1].trigger('click')
    await flushPromises()

    expect(fetchCustomAgent).toHaveBeenCalledWith('alpha', undefined, 'project')
    const dialog = w.findComponent(stubs.AgentFormDialog)
    expect(dialog.props('agent')).toBeNull()
    const draft = dialog.props('initialDraft') as any
    expect(draft.name).toBe('alpha-copy')
    expect(draft.sections.role).toContain('nội dung alpha')
  })

  // TC-D3: sau khi lưu bản sao, danh sách có thêm item mới, agent gốc còn nguyên.
  it('TC-D3: lưu bản sao ⇒ danh sách có thêm agent mới, agent gốc vẫn còn', async () => {
    const w = await mountEditor()
    await rowIcons(w, 0)[1].trigger('click')
    await flushPromises()

    const COPY = { name: 'alpha-copy', scope: 'project' as const, editable: true }
    fetchCustomAgents.mockResolvedValue({ agents: [ALPHA, BETA, COPY] })
    w.findComponent(stubs.AgentFormDialog).vm.$emit('saved', 'alpha-copy')
    await flushPromises()

    const names = w.findAll('.agent-list-name').map((n) => n.text())
    expect(names).toEqual(expect.arrayContaining(['alpha', 'alpha-copy']))
  })

  // TC-D5: bấm sao chép khi form khác đang mở dở ⇒ thay bằng form sao chép mới,
  // không có confirm mất dữ liệu (hành vi kế thừa nguyên trạng của mở-form-mới).
  it('TC-D5: sao chép khi dialog sửa agent khác đang mở ⇒ thay props, không confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    const w = await mountEditor()

    await rowIcons(w, 1)[3].trigger('click') // mở dialog sửa beta (icon edit)
    await flushPromises()
    expect(w.findComponent(stubs.AgentFormDialog).props('agent')).toMatchObject({ name: 'beta' })

    await rowIcons(w, 0)[1].trigger('click') // sao chép alpha trong khi dialog beta còn mở
    await flushPromises()

    expect(confirmSpy).not.toHaveBeenCalled()
    const dialog = w.findComponent(stubs.AgentFormDialog)
    expect(dialog.props('agent')).toBeNull()
    expect((dialog.props('initialDraft') as any).name).toBe('alpha-copy')
  })

  // TC-D6 (edge): agent bị xoá ở nơi khác ⇒ báo lỗi, form KHÔNG mở ra.
  it('TC-D6: sao chép agent vừa bị xoá ở nơi khác ⇒ hiện lỗi, không mở form, danh sách vẫn dùng được', async () => {
    fetchCustomAgent.mockRejectedValueOnce(new Error('ENOENT: alpha không còn tồn tại'))
    const w = await mountEditor()

    await rowIcons(w, 0)[1].trigger('click')
    await flushPromises()

    expect(w.find('.err').text()).toContain('ENOENT')
    expect(w.find('.stub-dialog').exists()).toBe(false)

    // Danh sách vẫn thao tác được — sao chép item còn lại hoạt động bình thường.
    await rowIcons(w, 1)[1].trigger('click')
    await flushPromises()
    expect(w.find('.stub-dialog').exists()).toBe(true)
  })
})

describe('AgentEditor — dialog (TC-17)', () => {
  it('icon sửa ⇒ mở dialog với đúng agent, không đổi agent đang xem', async () => {
    const w = await mountEditor()
    await w.findAll('.agent-list-name')[0].trigger('click')
    await flushPromises()

    await rowIcons(w, 1)[3].trigger('click')
    await flushPromises()

    expect(w.findComponent(stubs.AgentFormDialog).props('agent')).toMatchObject({ name: 'beta' })
    expect(w.text()).toContain('nội dung alpha')
  })

  it('Agent mới ⇒ dialog mở ở chế độ tạo mới', async () => {
    const w = await mountEditor()
    await w.findAll('.agent-side-actions button')[0].trigger('click')
    const dialog = w.findComponent(stubs.AgentFormDialog)
    expect(dialog.props('agent')).toBeNull()
    expect(dialog.props('initialDraft')).toBeNull()
  })
})

// Review [should]: payload `name` của emit `saved` phải được dùng, nếu không
// đổi tên agent rồi lưu sẽ hiện lại bản cũ ở main.
describe('AgentEditor — sau khi lưu (TC-35)', () => {
  it('lưu không đổi tên ⇒ nạp lại đúng agent đang xem', async () => {
    const w = await mountEditor()
    await w.findAll('.agent-list-name')[0].trigger('click')
    await flushPromises()

    await rowIcons(w, 0)[3].trigger('click')
    await flushPromises()

    fetchCustomAgent.mockResolvedValue({ name: 'alpha', content: '## Role\n\nbản mới' })
    w.findComponent(stubs.AgentFormDialog).vm.$emit('saved', 'alpha')
    await flushPromises()

    expect(w.text()).toContain('bản mới')
  })

  it('đổi tên rồi lưu ⇒ main chuyển sang agent tên mới, không kẹt bản cũ', async () => {
    const w = await mountEditor()
    await w.findAll('.agent-list-name')[0].trigger('click')
    await flushPromises()

    await rowIcons(w, 0)[3].trigger('click')
    await flushPromises()

    const renamed = { name: 'alpha-doi-ten', scope: 'project' as const, editable: true }
    fetchCustomAgents.mockResolvedValue({ agents: [ALPHA, renamed, BETA] })
    fetchCustomAgent.mockResolvedValue({ name: renamed.name, content: '## Role\n\nnội dung mới' })

    w.findComponent(stubs.AgentFormDialog).vm.$emit('saved', renamed.name)
    await flushPromises()

    expect(fetchCustomAgent).toHaveBeenLastCalledWith(renamed.name, undefined, 'project')
    expect(w.text()).toContain('nội dung mới')
  })
})

// Review [should]: cột trái rộng 0 khi thu sub-menu ⇒ thông báo phải hiện ở main.
describe('AgentEditor — thu sub-menu (E1, E12)', () => {
  it('thu sub-menu ⇒ --left-collapsed thắng --no-main, main còn để hiện empty state', async () => {
    const w = await mountEditor({ subSidebarCollapsed: true })
    expect(body(w).classes()).toContain('c-screen-layout__body--left-collapsed')
    expect(body(w).classes()).not.toContain('c-screen-layout__body--no-main')
    expect(w.find('.agent-main-empty').exists()).toBe(true)
  })

  it('thu sub-menu ⇒ lỗi hiện ở main chứ không mất hẳn', async () => {
    fetchCustomAgents.mockRejectedValue(new Error('mất kết nối'))
    const w = await mountEditor({ subSidebarCollapsed: true })
    expect(w.find('.agent-side-menu').exists()).toBe(false)
    expect(w.find('.err').text()).toContain('mất kết nối')
  })

  it('không thu ⇒ lỗi hiện ở cột trái, không nhân đôi ở main', async () => {
    fetchCustomAgents.mockRejectedValue(new Error('mất kết nối'))
    const w = await mountEditor()
    expect(w.findAll('.err')).toHaveLength(1)
    expect(w.find('.c-screen-layout__left .err').exists()).toBe(true)
  })
})

// E12: agent vừa bị xoá ngoài dashboard — không được kẹt spinner.
describe('AgentEditor — nạp viewer thất bại (E12)', () => {
  it('fetch lỗi ⇒ main về empty state kèm lỗi, không kẹt loading', async () => {
    fetchCustomAgent.mockRejectedValue(new Error('ENOENT'))
    const w = await mountEditor()
    await w.findAll('.agent-list-name')[0].trigger('click')
    await flushPromises()

    expect(w.find('.c-md-view').exists()).toBe(false)
    expect(w.text()).not.toContain('Đang tải')
    expect(w.find('.err').text()).toContain('ENOENT')
    expect(body(w).classes()).toContain('c-screen-layout__body--no-main')
  })
})
