import { mountWithI18n as mount } from '../../../helpers/i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import AgentEditor from '@/features/agent-editor/components/AgentEditor.vue'

const fetchCustomAgents = vi.fn()
const fetchCustomAgent = vi.fn()
const deleteCustomAgent = vi.fn()
const exportCustomAgent = vi.fn()

vi.mock('@/features/agent-editor/scripts/agentEditorApi', () => ({
  fetchCustomAgents: (...a: unknown[]) => fetchCustomAgents(...a),
  fetchCustomAgent: (...a: unknown[]) => fetchCustomAgent(...a),
  deleteCustomAgent: (...a: unknown[]) => deleteCustomAgent(...a),
  exportCustomAgent: (...a: unknown[]) => exportCustomAgent(...a),
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
  AgentTemplatePicker: { template: '<div class="stub-templates" />' },
  AgentNlWizard: { template: '<div class="stub-nl" />' },
}

async function mountEditor(props: Record<string, unknown> = {}) {
  const w = mount(AgentEditor, { props, global: { stubs } })
  await flushPromises()
  return w
}

const body = (w: Awaited<ReturnType<typeof mountEditor>>) => w.find('.c-screen-layout__body')

beforeEach(() => {
  vi.clearAllMocks()
  fetchCustomAgents.mockResolvedValue({ agents: [ALPHA, BETA] })
  fetchCustomAgent.mockResolvedValue({ name: 'alpha', content: '## Role\n\nnội dung alpha' })
  deleteCustomAgent.mockResolvedValue({})
  exportCustomAgent.mockResolvedValue({ path: '/tmp/alpha.md' })
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

describe('AgentEditor — xoá agent (TC-18, TC-19, TC-20, E2, E3)', () => {
  it('hủy confirm ⇒ không gọi API xoá', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const w = await mountEditor()
    await w.findAll('.agent-list-item')[0].findAll('.icon-btn')[2].trigger('click')
    await flushPromises()
    expect(deleteCustomAgent).not.toHaveBeenCalled()
  })

  // E2/TC-19: xoá đúng agent đang xem ⇒ main phải về rỗng, không giữ nội dung cũ.
  it('xoá agent đang xem ⇒ main về empty state, --no-main bật lại', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const w = await mountEditor()
    await w.findAll('.agent-list-name')[0].trigger('click')
    await flushPromises()
    expect(w.find('.c-md-view').exists()).toBe(true)

    fetchCustomAgents.mockResolvedValue({ agents: [BETA] })
    await w.findAll('.agent-list-item')[0].findAll('.icon-btn')[2].trigger('click')
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
    await w.findAll('.agent-list-item')[1].findAll('.icon-btn')[2].trigger('click')
    await flushPromises()

    expect(w.find('.c-md-view').exists()).toBe(true)
    expect(w.text()).toContain('nội dung alpha')
  })

  // TC-20: xoá lỗi ⇒ báo lỗi đọc được, agent vẫn còn.
  it('xoá thất bại ⇒ hiện lỗi, danh sách không mất mục', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    deleteCustomAgent.mockRejectedValue(new Error('EACCES: khoá file'))
    const w = await mountEditor()
    await w.findAll('.agent-list-item')[0].findAll('.icon-btn')[2].trigger('click')
    await flushPromises()

    expect(w.find('.err').text()).toContain('EACCES')
    expect(w.findAll('.agent-list-item')).toHaveLength(2)
  })
})

describe('AgentEditor — Export (qa.md Q1 → A, E6, E7)', () => {
  it('chưa chọn agent ⇒ Export disabled', async () => {
    const w = await mountEditor()
    expect(w.findAll('.agent-side-actions button')[3].attributes('disabled')).toBeDefined()
  })

  it('đang xem agent ⇒ Export gọi đúng agent đó và báo đường dẫn', async () => {
    const w = await mountEditor()
    await w.findAll('.agent-list-name')[1].trigger('click')
    await flushPromises()

    await w.findAll('.agent-side-actions button')[3].trigger('click')
    await flushPromises()

    expect(exportCustomAgent).toHaveBeenCalledWith('beta', false, undefined, 'project')
    expect(w.find('.ok-msg').text()).toContain('/tmp/alpha.md')
  })

  // E7: trúng file đã tồn tại ⇒ confirm rồi gọi lại với overwrite.
  it('file đã tồn tại + đồng ý ghi đè ⇒ gọi lại với overwrite=true', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    exportCustomAgent
      .mockRejectedValueOnce(new Error('file exists'))
      .mockResolvedValueOnce({ path: '/tmp/alpha.md' })

    const w = await mountEditor()
    await w.findAll('.agent-list-name')[0].trigger('click')
    await flushPromises()
    await w.findAll('.agent-side-actions button')[3].trigger('click')
    await flushPromises()

    expect(exportCustomAgent).toHaveBeenLastCalledWith('alpha', true, undefined, 'project')
  })

  it('file đã tồn tại + từ chối ghi đè ⇒ hiện lỗi, không gọi lại', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    exportCustomAgent.mockRejectedValue(new Error('file exists'))

    const w = await mountEditor()
    await w.findAll('.agent-list-name')[0].trigger('click')
    await flushPromises()
    await w.findAll('.agent-side-actions button')[3].trigger('click')
    await flushPromises()

    expect(exportCustomAgent).toHaveBeenCalledTimes(1)
    expect(w.find('.err').text()).toContain('file exists')
  })
})

describe('AgentEditor — dialog và wizard (TC-17, E13, D4)', () => {
  it('icon sửa ⇒ mở dialog với đúng agent, không đổi agent đang xem', async () => {
    const w = await mountEditor()
    await w.findAll('.agent-list-name')[0].trigger('click')
    await flushPromises()

    await w.findAll('.agent-list-item')[1].findAll('.icon-btn')[1].trigger('click')
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

  it.each([
    [1, '.stub-templates'],
    [2, '.stub-nl'],
  ])('nút thứ %i mở wizard trong .modal-body', async (index, selector) => {
    const w = await mountEditor()
    await w.findAll('.agent-side-actions button')[index].trigger('click')
    expect(w.find(selector).exists()).toBe(true)
    // Hợp đồng .modal ở _shell.scss: nội dung PHẢI nằm trong đúng một .modal-body.
    expect(w.find(`.modal > .modal-body ${selector}`).exists()).toBe(true)
  })

  // E13/D4: apply-draft đóng wizard rồi mới mở dialog — hai cái loại trừ nhau.
  it('apply-draft ⇒ đóng wizard, mở dialog kèm initialDraft', async () => {
    const w = await mountEditor()
    await w.findAll('.agent-side-actions button')[1].trigger('click')
    w.findComponent(stubs.AgentTemplatePicker).vm.$emit('apply-draft', { name: 'từ-template' })
    await flushPromises()

    expect(w.find('.stub-templates').exists()).toBe(false)
    const dialog = w.findComponent(stubs.AgentFormDialog)
    expect(dialog.props('agent')).toBeNull()
    expect(dialog.props('initialDraft')).toEqual({ name: 'từ-template' })
  })
})

// Review [should]: payload `name` của emit `saved` phải được dùng, nếu không
// đổi tên agent rồi lưu sẽ hiện lại bản cũ ở main.
describe('AgentEditor — sau khi lưu (TC-35)', () => {
  it('lưu không đổi tên ⇒ nạp lại đúng agent đang xem', async () => {
    const w = await mountEditor()
    await w.findAll('.agent-list-name')[0].trigger('click')
    await flushPromises()

    await w.findAll('.agent-list-item')[0].findAll('.icon-btn')[1].trigger('click')
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

    await w.findAll('.agent-list-item')[0].findAll('.icon-btn')[1].trigger('click')
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
