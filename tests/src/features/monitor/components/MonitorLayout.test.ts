import { mountWithI18n as mount } from '../../../helpers/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import MonitorLayout from '@/features/monitor/components/MonitorLayout.vue'
import { STORAGE_KEY, useAppSettings } from '@/core/composables/useAppSettings'
import viMonitor from '@/features/monitor/locales/vi'

const tasks = [
  {
    task_id: 'B4488',
    current_phase: 'designer',
    hitl_pending: null,
    has_qa: false,
    state_ok: true,
    artifacts: { 'investigate.md': { exists: true } },
  },
]

function seedAppSettings(patch: Record<string, unknown> = {}) {
  localStorage.clear()
  if (Object.keys(patch).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(patch))
  const { load } = useAppSettings()
  load()
}

function dispatchOutsideClick(target: Element) {
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

// `onClickOutside` (@vueuse/core) debounces its window "click" listener via a
// real `setTimeout(0)` macrotask (not a microtask) — awaiting `nextTick()`
// alone isn't enough to clear that flag between two synthetic clicks.
function flushMacrotask() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
  const { load } = useAppSettings()
  load()
  document.body.innerHTML = ''
})

// Collapse state giờ sống ở shell (App.vue + useSubSidebarCollapse) và xuống đây
// như một v-model — panel chỉ render theo prop và emit khi cần đổi.
describe('MonitorLayout — sub-sidebar collapse (state từ shell)', () => {
  it('prop subSidebarCollapsed=true thu gọn panel và bỏ mount nội dung', () => {
    const w = mount(MonitorLayout, { props: { tasks, subSidebarCollapsed: true } })

    expect(w.find('.monitor-sub-sidebar').classes()).toContain('monitor-sub-sidebar--collapsed')
    expect(w.find('.monitor-layout').classes()).toContain('monitor-layout--sub-collapsed')
    expect(w.find('.project-bar').exists()).toBe(false)
    expect(w.find('.task-row').exists()).toBe(false)
  })

  it('prop subSidebarCollapsed=false (mặc định) hiện đủ nội dung panel', () => {
    const w = mount(MonitorLayout, { props: { tasks } })

    expect(w.find('.monitor-sub-sidebar').classes()).not.toContain('monitor-sub-sidebar--collapsed')
    expect(w.find('.monitor-layout').classes()).not.toContain('monitor-layout--sub-collapsed')
    expect(w.find('.project-bar').exists()).toBe(true)
    expect(w.find('.task-row').exists()).toBe(true)
  })

  it('không còn nút thu/phóng bên trong sub-sidebar', () => {
    const w = mount(MonitorLayout, { props: { tasks } })

    expect(w.find('.monitor-sub-sidebar-collapse-btn').exists()).toBe(false)
    // Panel thu gọn cũng không mọc lại nút nào — thu gọn thì chỉ còn dải rỗng 0px.
    const collapsed = mount(MonitorLayout, { props: { tasks, subSidebarCollapsed: true } })
    expect(collapsed.find('.monitor-sub-sidebar').findAll('button')).toHaveLength(0)
  })
})

describe('MonitorLayout — auto-collapse task file-list on outside click (mục 7)', () => {
  it('does nothing when the setting is off (default)', async () => {
    seedAppSettings()
    const outside = document.createElement('div')
    document.body.appendChild(outside)

    const w = mount(MonitorLayout, { attachTo: document.body, props: { tasks } })
    await w.find('.task-row').trigger('click')
    expect(w.find('.file-list').exists()).toBe(true)
    await flushMacrotask()

    dispatchOutsideClick(outside)
    await w.vm.$nextTick()

    expect(w.find('.file-list').exists()).toBe(true)
    w.unmount()
  })

  it('collapses the task list when the setting is on and the click lands outside the sub-sidebar', async () => {
    seedAppSettings({ collapseTaskExpandOnOutside: true })
    const outside = document.createElement('div')
    document.body.appendChild(outside)

    const w = mount(MonitorLayout, { attachTo: document.body, props: { tasks } })
    await w.find('.task-row').trigger('click')
    expect(w.find('.file-list').exists()).toBe(true)
    await flushMacrotask()

    dispatchOutsideClick(outside)
    await w.vm.$nextTick()

    expect(w.find('.file-list').exists()).toBe(false)
    w.unmount()
  })

  it('does not collapse when the click lands inside the sub-sidebar', async () => {
    seedAppSettings({ collapseTaskExpandOnOutside: true })

    const w = mount(MonitorLayout, { attachTo: document.body, props: { tasks } })
    await w.find('.task-row').trigger('click')
    expect(w.find('.file-list').exists()).toBe(true)
    await flushMacrotask()

    dispatchOutsideClick(w.find('.monitor-sub-sidebar').element)
    await w.vm.$nextTick()

    expect(w.find('.file-list').exists()).toBe(true)
    w.unmount()
  })
})

describe('MonitorLayout — auto-collapse sub-sidebar on outside click', () => {
  it('does not collapse the sub-sidebar when the setting is off', async () => {
    seedAppSettings()
    const outside = document.createElement('div')
    document.body.appendChild(outside)

    const w = mount(MonitorLayout, { attachTo: document.body, props: { tasks } })
    await flushMacrotask()

    dispatchOutsideClick(outside)
    await w.vm.$nextTick()

    expect(w.emitted('update:subSidebarCollapsed')).toBeUndefined()
    w.unmount()
  })

  it('collapses the sub-sidebar when the setting is on and click is outside', async () => {
    seedAppSettings({ collapseMonitorSubSidebarOnOutside: true })
    const outside = document.createElement('div')
    document.body.appendChild(outside)

    const w = mount(MonitorLayout, { attachTo: document.body, props: { tasks } })
    await flushMacrotask()

    dispatchOutsideClick(outside)
    await w.vm.$nextTick()

    expect(w.emitted('update:subSidebarCollapsed')).toEqual([[true]])
    w.unmount()
  })

  it('does not collapse when the click lands inside a teleported .modal-backdrop', async () => {
    seedAppSettings({ collapseMonitorSubSidebarOnOutside: true })
    const modal = document.createElement('div')
    modal.className = 'modal-backdrop'
    const item = document.createElement('button')
    item.className = 'folder-picker-item'
    modal.appendChild(item)
    document.body.appendChild(modal)

    const w = mount(MonitorLayout, { attachTo: document.body, props: { tasks } })
    await flushMacrotask()

    dispatchOutsideClick(item)
    await w.vm.$nextTick()

    expect(w.emitted('update:subSidebarCollapsed')).toBeUndefined()
    expect(w.find('.project-bar').exists()).toBe(true)
    w.unmount()
  })

  // Mode icon nằm trong `.sidebar` và giờ chính là nút toggle sub-sidebar: nếu
  // click-outside vẫn bắn, cú click sẽ collapse rồi bị toggle mở lại ⇒ nhánh
  // "đang hiện → ẩn" không bao giờ chạy được.
  it('does not collapse when the click lands inside the rail .sidebar', async () => {
    seedAppSettings({ collapseMonitorSubSidebarOnOutside: true })
    const rail = document.createElement('aside')
    rail.className = 'sidebar'
    const modeBtn = document.createElement('button')
    modeBtn.className = 'mode-btn'
    rail.appendChild(modeBtn)
    document.body.appendChild(rail)

    const w = mount(MonitorLayout, { attachTo: document.body, props: { tasks } })
    await flushMacrotask()

    dispatchOutsideClick(modeBtn)
    await w.vm.$nextTick()

    expect(w.emitted('update:subSidebarCollapsed')).toBeUndefined()
    w.unmount()
  })

  // Chặn click từ rail chỉ được tắt nhánh sub-sidebar. `collapseTaskExpandOnOutside`
  // là setting độc lập, có từ trước task này — click vào rail vẫn phải đóng file-list.
  it('still collapses the task file-list on a rail click when only that setting is on', async () => {
    seedAppSettings({ collapseTaskExpandOnOutside: true, collapseMonitorSubSidebarOnOutside: true })
    const rail = document.createElement('aside')
    rail.className = 'sidebar'
    const modeBtn = document.createElement('button')
    modeBtn.className = 'mode-btn'
    rail.appendChild(modeBtn)
    document.body.appendChild(rail)

    const w = mount(MonitorLayout, { attachTo: document.body, props: { tasks } })
    await w.find('.task-row').trigger('click')
    expect(w.find('.file-list').exists()).toBe(true)
    await flushMacrotask()

    dispatchOutsideClick(modeBtn)
    await w.vm.$nextTick()

    expect(w.find('.file-list').exists()).toBe(false)
    expect(w.emitted('update:subSidebarCollapsed')).toBeUndefined()
    w.unmount()
  })
})


// Trước Tde5b317d nút xoá ở khu badge chỉ hiện khi `!selected.state_ok` ⇒ task
// khoẻ và task đã lưu trữ không bao giờ xoá được từ đây.
describe('MonitorLayout — nút xoá task (Tde5b317d)', () => {
  const healthy = { ...tasks[0] }
  const archived = { ...tasks[0], archived: true }
  const broken = { ...tasks[0], state_ok: false }

  /**
   * Mount kèm `selected` — PipelineView dùng @vue-flow (`getBBox`, không có
   * trong jsdom) và ArtifactPanel tự fetch; cả hai không liên quan tới nút xoá.
   */
  function mountLayout(props: Record<string, any>) {
    return mount(MonitorLayout, {
      props,
      global: { stubs: { PipelineView: true, ArtifactPanel: true } },
    })
  }

  /** fetch mock phân nhánh theo URL: /api/jobs (GET) vs /api/tasks/<id> (DELETE). */
  function stubFetch(opts: { jobs?: Record<string, any[]>; deleteResponse?: any } = {}) {
    const jobs = opts.jobs ?? {}
    const fetchMock = vi.fn(async (input: any, init: any = {}) => {
      const url = String(input)
      if (url.includes('/api/jobs')) {
        const status = new URL(url, 'http://x').searchParams.get('status') ?? ''
        return { ok: true, status: 200, json: async () => ({ jobs: jobs[status] ?? [] }) }
      }
      if (url.includes('/api/tasks/')) {
        return opts.deleteResponse ?? { ok: true, status: 200, json: async () => ({ ok: true }) }
      }
      throw new Error(`unexpected fetch: ${init.method ?? 'GET'} ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  function deleteCalls(fetchMock: any) {
    return fetchMock.mock.calls.filter(([, init]: any[]) => init?.method === 'DELETE')
  }

  it.each([
    ['task khoẻ', healthy],
    ['task đã lưu trữ', archived],
    ['task state hỏng', broken],
  ])('hiện nút xoá ở khu badge cho %s', (_label, selected) => {
    const w = mountLayout({ tasks, selected, selectedId: selected.task_id })
    const btn = w.find('.badges .btn-delete-detail')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toBe(viMonitor.layout.deleteTask)
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  it('vá state xong nút xoá vẫn còn (đúng triệu chứng user báo)', async () => {
    const w = mountLayout({ tasks, selected: broken, selectedId: 'B4488' })
    expect(w.find('.badges .btn-delete-detail').exists()).toBe(true)

    // state được vá ⇒ state_ok: true; nút xoá KHÔNG được biến mất theo.
    await w.setProps({ selected: healthy })
    expect(w.find('.badges .btn-delete-detail').exists()).toBe(true)
  })

  it('xác nhận rồi xoá: đúng một DELETE, đúng task + project, và emit task-deleted', async () => {
    const fetchMock = stubFetch()
    const confirmMock = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmMock)

    const w = mountLayout({
      tasks,
      selected: healthy,
      selectedId: 'B4488',
      selectedProjectId: 'proj-1',
    })
    await w.find('.badges .btn-delete-detail').trigger('click')
    await flushPromises()

    expect(confirmMock).toHaveBeenCalledWith(viMonitor.layout.confirmDelete)
    const calls = deleteCalls(fetchMock)
    expect(calls.length).toBe(1)
    expect(String(calls[0][0])).toContain('/api/tasks/B4488')
    expect(String(calls[0][0])).toContain('project=proj-1')
    expect(w.emitted('task-deleted')?.[0]).toEqual(['B4488'])
  })

  it('cảnh báo mạnh hơn khi task còn job đang chạy', async () => {
    stubFetch({ jobs: { running: [{ metadata: { taskId: 'B4488', projectId: 'proj-1' } }] } })
    const confirmMock = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmMock)

    const w = mountLayout({
      tasks,
      selected: healthy,
      selectedId: 'B4488',
      selectedProjectId: 'proj-1',
    })
    await w.find('.badges .btn-delete-detail').trigger('click')
    await flushPromises()

    expect(confirmMock).toHaveBeenCalledWith(viMonitor.layout.confirmDeleteRunning)
    expect(viMonitor.layout.confirmDeleteRunning).not.toBe(viMonitor.layout.confirmDelete)
  })

  it('không cảnh báo khi job sống thuộc project khác', async () => {
    stubFetch({ jobs: { running: [{ metadata: { taskId: 'B4488', projectId: 'proj-2' } }] } })
    const confirmMock = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmMock)

    const w = mountLayout({
      tasks,
      selected: healthy,
      selectedId: 'B4488',
      selectedProjectId: 'proj-1',
    })
    await w.find('.badges .btn-delete-detail').trigger('click')
    await flushPromises()

    expect(confirmMock).toHaveBeenCalledWith(viMonitor.layout.confirmDelete)
  })

  it('huỷ ở hộp xác nhận: không DELETE, không emit, nút dùng lại được', async () => {
    const fetchMock = stubFetch({ jobs: { running: [{ metadata: { taskId: 'B4488' } }] } })
    vi.stubGlobal('confirm', vi.fn(() => false))

    const w = mountLayout({
      tasks,
      selected: healthy,
      selectedId: 'B4488',
      selectedProjectId: 'proj-1',
    })
    await w.find('.badges .btn-delete-detail').trigger('click')
    await flushPromises()

    expect(deleteCalls(fetchMock).length).toBe(0)
    expect(w.emitted('task-deleted')).toBeFalsy()
    expect(w.find('.badges .btn-delete-detail').attributes('disabled')).toBeUndefined()
  })

  it('bấm liên tiếp chỉ gửi một DELETE', async () => {
    const fetchMock = stubFetch()
    const confirmMock = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmMock)

    const w = mountLayout({
      tasks,
      selected: healthy,
      selectedId: 'B4488',
      selectedProjectId: 'proj-1',
    })
    const btn = w.find('.badges .btn-delete-detail')
    btn.trigger('click')
    btn.trigger('click')
    await flushPromises()

    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(deleteCalls(fetchMock).length).toBe(1)
  })

  it('DELETE lỗi: không emit, hiện lỗi, nút không kẹt', async () => {
    stubFetch({ deleteResponse: { ok: false, status: 500, json: async () => ({ error: 'nope' }) } })
    vi.stubGlobal('confirm', vi.fn(() => true))

    const w = mountLayout({
      tasks,
      selected: healthy,
      selectedId: 'B4488',
      selectedProjectId: 'proj-1',
    })
    await w.find('.badges .btn-delete-detail').trigger('click')
    await flushPromises()

    expect(w.emitted('task-deleted')).toBeFalsy()
    expect(w.find('.task-head .art-warning').text()).toContain('nope')
    expect(w.find('.badges .btn-delete-detail').attributes('disabled')).toBeUndefined()
  })

  // Nhóm archived phải nối @task-deleted lên trên, nếu không hàng vừa xoá vẫn
  // nằm lại trên màn hình cho tới lần poll sau.
  it('chuyển tiếp task-deleted phát ra từ nhóm task đã lưu trữ', async () => {
    stubFetch()
    vi.stubGlobal('confirm', vi.fn(() => true))

    const w = mountLayout({ tasks: [archived], selectedProjectId: 'proj-1' })
    await w.find('.archived-group .btn-delete').trigger('click')
    await flushPromises()

    expect(w.emitted('task-deleted')?.[0]).toEqual(['B4488'])
  })
})
