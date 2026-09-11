import { mountWithI18n as mount } from '../../../helpers/i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import MonitorLayout from '@/features/monitor/components/MonitorLayout.vue'
import { STORAGE_KEY, useAppSettings } from '@/frontend/composables/useAppSettings'
import viMonitor from '@/features/monitor/locales/vi'
import enMonitor from '@/features/monitor/locales/en'

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

function jsonRes(body: any, status = 200) {
  return { ok: status < 400, status, json: async () => body }
}

interface StubOpts {
  jobs?: Record<string, any[]>
  deleteResponse?: any
  /** Response cho GET /api/tasks/:id/worktree; hàm để đổi giữa các lần gọi. */
  worktreeResponse?: any | (() => any)
}

/** Chỉ gọi factory ở nhánh GET — ca "đọc lại sau khi xoá" đếm số lần đọc. */
function worktreeRes(opts: StubOpts) {
  const wt =
    typeof opts.worktreeResponse === 'function' ? opts.worktreeResponse() : opts.worktreeResponse
  return wt ?? jsonRes({ worktree: null, ambiguous: false })
}

function jobsRes(url: string, jobs: StubOpts['jobs']) {
  const status = new URL(url, 'http://x').searchParams.get('status') ?? ''
  return jsonRes({ jobs: jobs?.[status] ?? [] })
}

/** fetch mock phân nhánh theo URL: /api/jobs · /worktree · /api/tasks/<id>. */
function stubFetch(opts: StubOpts = {}) {
  const fetchMock = vi.fn(async (input: any, init: any = {}) => {
    const url = String(input)
    const isGet = String(init.method ?? 'GET').toUpperCase() === 'GET'
    if (url.includes('/api/jobs')) return jobsRes(url, opts.jobs)
    // Phải đứng trước nhánh /api/tasks/ — nếu không, GET trạng thái worktree
    // rơi vào response của DELETE task.
    if (url.includes('/worktree') && isGet) return worktreeRes(opts)
    if (url.includes('/api/tasks/')) return opts.deleteResponse ?? jsonRes({ ok: true })
    throw new Error(`unexpected fetch: ${init.method ?? 'GET'} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const cleanWorktree = {
  path: '/repo/.claude/worktrees/B4488',
  relPath: '.claude/worktrees/B4488',
  branch: 'fix/B4488/demo',
  detached: false,
  exists: true,
  dirty: false,
  dirtyCount: 0,
  locked: false,
  lockReason: null,
  removable: true,
  blockedBy: null,
}

function worktreeOk(worktree: any, ambiguous = false) {
  return jsonRes({ worktree, ambiguous })
}

function deleteCalls(fetchMock: any) {
  return fetchMock.mock.calls.filter(([, init]: any[]) => init?.method === 'DELETE')
}

/** Chuỗi truyền vào lần `confirm()` đầu tiên. */
function confirmArg(confirmMock: any, index = 0): string {
  return String(confirmMock.mock.calls[index]?.[0] ?? '')
}

// Trước Tde5b317d nút xoá ở khu badge chỉ hiện khi `!selected.state_ok` ⇒ task
// khoẻ và task đã lưu trữ không bao giờ xoá được từ đây.
describe('MonitorLayout — nút xoá task (Tde5b317d)', () => {
  const healthy = { ...tasks[0] }
  const archived = { ...tasks[0], archived: true }
  const broken = { ...tasks[0], state_ok: false }


  // Mount kèm `selected` luôn kéo GET /api/tasks/:id/worktree — không stub thì
  // mọi ca dưới đây đều bắn một fetch thật vào jsdom.
  beforeEach(() => {
    stubFetch()
  })

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

// Nút "Dọn worktree" (T161678b4) — badge trạng thái + xoá thủ công từ task detail.
describe('MonitorLayout — nút dọn worktree (T161678b4)', () => {
  const completed = { ...tasks[0], current_phase: 'completed' }
  const archivedDone = { ...tasks[0], archived: true }
  const running = { ...tasks[0], current_phase: 'designer' }

  function mountDone(props: Record<string, any> = {}) {
    return mountLayout({
      tasks,
      selected: completed,
      selectedId: 'B4488',
      selectedProjectId: 'proj-1',
      ...props,
    })
  }

  beforeEach(() => {
    stubFetch()
  })

  it('task đã hoàn tất + có worktree: hiện badge và nút dọn', async () => {
    stubFetch({ worktreeResponse: worktreeOk(cleanWorktree) })

    const w = mountDone()
    await flushPromises()

    const badge = w.find('.badges .badge.worktree')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('fix/B4488/demo')
    expect(badge.attributes('title')).toBe(cleanWorktree.path)

    const btn = w.find('.badges .btn-clean-worktree')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toContain(viMonitor.layout.cleanWorktree)
    expect(btn.attributes('title')).toBe(viMonitor.layout.cleanWorktreeTitle)
    expect(btn.attributes('aria-label')).toBe(viMonitor.layout.cleanWorktree)
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  it('task đã lưu trữ cũng dọn được', async () => {
    stubFetch({ worktreeResponse: worktreeOk(cleanWorktree) })

    const w = mountDone({ selected: archivedDone })
    await flushPromises()

    expect(w.find('.badges .btn-clean-worktree').exists()).toBe(true)
  })

  it('task chưa xong: badge vẫn hiện nhưng nút bị ẩn', async () => {
    stubFetch({ worktreeResponse: worktreeOk(cleanWorktree) })

    const w = mountDone({ selected: running })
    await flushPromises()

    expect(w.find('.badges .badge.worktree').exists()).toBe(true)
    expect(w.find('.badges .btn-clean-worktree').exists()).toBe(false)
  })

  it('không có worktree: không badge, không nút', async () => {
    const w = mountDone()
    await flushPromises()

    expect(w.find('.badges .badge.worktree').exists()).toBe(false)
    expect(w.find('.badges .btn-clean-worktree').exists()).toBe(false)
  })

  it('nhiều worktree cùng khớp: badge cảnh báo, không có nút', async () => {
    stubFetch({ worktreeResponse: worktreeOk(null, true) })

    const w = mountDone()
    await flushPromises()

    const badge = w.find('.badges .badge.err')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe(viMonitor.layout.worktreeAmbiguous)
    expect(w.find('.badges .btn-clean-worktree').exists()).toBe(false)
  })

  it('xác nhận rồi dọn: đúng một DELETE tới /worktree, đúng task + project', async () => {
    const fetchMock = stubFetch({ worktreeResponse: worktreeOk(cleanWorktree) })
    const confirmMock = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmMock)

    const w = mountDone()
    await flushPromises()
    await w.find('.badges .btn-clean-worktree').trigger('click')
    await flushPromises()

    const message = confirmArg(confirmMock)
    expect(message).toContain(cleanWorktree.relPath)
    expect(message).toContain(cleanWorktree.branch)

    const calls = deleteCalls(fetchMock)
    expect(calls.length).toBe(1)
    expect(String(calls[0][0])).toContain('/api/tasks/B4488/worktree')
    expect(String(calls[0][0])).toContain('project=proj-1')
  })

  it('huỷ ở hộp xác nhận: không DELETE, nút không kẹt disabled', async () => {
    const fetchMock = stubFetch({ worktreeResponse: worktreeOk(cleanWorktree) })
    vi.stubGlobal('confirm', vi.fn(() => false))

    const w = mountDone()
    await flushPromises()
    await w.find('.badges .btn-clean-worktree').trigger('click')
    await flushPromises()

    expect(deleteCalls(fetchMock).length).toBe(0)
    expect(w.find('.badges .btn-clean-worktree').attributes('disabled')).toBeUndefined()
  })

  it('bấm liên tiếp chỉ gửi một DELETE', async () => {
    const fetchMock = stubFetch({ worktreeResponse: worktreeOk(cleanWorktree) })
    const confirmMock = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmMock)

    const w = mountDone()
    await flushPromises()
    const btn = w.find('.badges .btn-clean-worktree')
    btn.trigger('click')
    btn.trigger('click')
    await flushPromises()

    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(deleteCalls(fetchMock).length).toBe(1)
  })

  it('task còn job đang chạy: dùng hộp xác nhận cảnh báo mạnh hơn', async () => {
    stubFetch({
      worktreeResponse: worktreeOk(cleanWorktree),
      jobs: { running: [{ metadata: { taskId: 'B4488', projectId: 'proj-1' } }] },
    })
    const confirmMock = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmMock)

    const w = mountDone()
    await flushPromises()
    await w.find('.badges .btn-clean-worktree').trigger('click')
    await flushPromises()

    const message = confirmArg(confirmMock)
    expect(message).toContain(viMonitor.layout.confirmCleanWorktreeRunning.split('{')[0])
  })

  it('worktree bẩn: hiện lỗi kèm số lượng và tên file, nút không kẹt', async () => {
    stubFetch({
      worktreeResponse: worktreeOk(cleanWorktree),
      deleteResponse: {
        ok: false,
        status: 409,
        json: async () => ({
          error: 'worktree_dirty',
          dirtyCount: 2,
          dirtyFiles: ['M src/a.ts', '?? b.txt'],
        }),
      },
    })
    vi.stubGlobal('confirm', vi.fn(() => true))

    const w = mountDone()
    await flushPromises()
    await w.find('.badges .btn-clean-worktree').trigger('click')
    await flushPromises()

    const warning = w.findAll('.task-head .art-warning').at(-1)!
    expect(warning.text()).toContain('2')
    expect(warning.text()).toContain('src/a.ts')
    expect(w.find('.badges .btn-clean-worktree').attributes('disabled')).toBeUndefined()
  })

  it('dọn xong đọc lại trạng thái: badge và nút biến mất', async () => {
    let calls = 0
    stubFetch({
      worktreeResponse: () => {
        calls += 1
        return calls === 1 ? worktreeOk(cleanWorktree) : worktreeOk(null)
      },
    })
    vi.stubGlobal('confirm', vi.fn(() => true))

    const w = mountDone()
    await flushPromises()
    expect(w.find('.badges .btn-clean-worktree').exists()).toBe(true)

    await w.find('.badges .btn-clean-worktree').trigger('click')
    await flushPromises()

    expect(calls).toBe(2)
    expect(w.find('.badges .badge.worktree').exists()).toBe(false)
    expect(w.find('.badges .btn-clean-worktree').exists()).toBe(false)
  })
})

// Hai mã lỗi mới của bước dọn worktree phải ra chữ tiếng Việt của khoá tương
// ứng, không rơi vào nhánh thông báo chung.
describe('MonitorLayout — mã lỗi mới khi dọn worktree', () => {
  function mountDone(props: Record<string, any> = {}) {
    return mountLayout({
      tasks,
      selected: { ...tasks[0], current_phase: 'completed' },
      selectedId: 'B4488',
      selectedProjectId: 'proj-1',
      ...props,
    })
  }

  async function clickCleanWith(error: string) {
    stubFetch({
      worktreeResponse: worktreeOk(cleanWorktree),
      deleteResponse: { ok: false, status: 409, json: async () => ({ error }) },
    })
    vi.stubGlobal('confirm', vi.fn(() => true))

    const w = mountDone()
    await flushPromises()
    await w.find('.badges .btn-clean-worktree').trigger('click')
    await flushPromises()
    return w.findAll('.task-head .art-warning').at(-1)!.text()
  }

  it('task còn job đang chạy: nói rõ là do job, không phải lỗi chung', async () => {
    expect(await clickCleanWith('task_job_in_flight')).toBe(
      viMonitor.layout.worktreeErrJobInFlight,
    )
  })

  it('worktree detached: nói rõ commit sẽ mất ref và chỉ đường CLI', async () => {
    expect(await clickCleanWith('worktree_detached')).toBe(viMonitor.layout.worktreeErrDetached)
  })

  it('mã lạ vẫn hiện được một thông báo, không để trống', async () => {
    const text = await clickCleanWith('cai_gi_do_moi')
    expect(text.length).toBeGreaterThan(0)
    expect(text).not.toBe(viMonitor.layout.worktreeErrDetached)
  })
})

// Trạng thái worktree treo theo *cặp* (task, project): hai project khác nhau
// giữ được task cùng id, nên chỉ so task id là chưa đủ để biết response còn
// đúng chỗ hay không.
describe('MonitorLayout — trạng thái worktree bám cả task lẫn project', () => {
  const completed = { ...tasks[0], current_phase: 'completed' }

  /** Worktree của project khác — relPath khác để phân biệt trong DOM. */
  const otherWorktree = { ...cleanWorktree, relPath: '.claude/worktrees/other', branch: 'x/other' }

  it('đổi project khi GET còn treo: response cũ không ghi vào state', async () => {
    const pending: ((body: any) => void)[] = []
    const fetchMock = vi.fn(async (input: any, init: any = {}) => {
      const url = String(input)
      const isGet = String(init.method ?? 'GET').toUpperCase() === 'GET'
      if (url.includes('/api/jobs')) return jsonRes({ jobs: [] })
      if (url.includes('/worktree') && isGet) {
        return new Promise((resolve) => {
          pending.push((body) => resolve(jsonRes(body)))
        })
      }
      throw new Error(`unexpected fetch: ${init.method ?? 'GET'} ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const w = mountLayout({
      tasks,
      selected: completed,
      selectedId: 'B4488',
      selectedProjectId: 'proj-1',
    })
    // Người dùng đổi project trước khi request đầu tiên kịp trả về.
    await w.setProps({ selectedProjectId: 'proj-2' })
    await flushPromises()
    expect(pending.length).toBe(2)

    // Request của proj-2 về trước, rồi mới tới request cũ của proj-1.
    pending[1]({ worktree: otherWorktree, ambiguous: false })
    await flushPromises()
    pending[0]({ worktree: cleanWorktree, ambiguous: false })
    await flushPromises()

    // Badge phải còn là worktree của proj-2 — response cũ không được sơn lên.
    expect(w.find('.badges .badge.worktree').text()).toContain(otherWorktree.branch)
  })

  /**
   * Cửa sổ đua thật nằm ở lần `await` **trước** hộp xác nhận: soạn câu confirm
   * phải hỏi `/api/jobs` xem task còn job không. `confirm()` của trình duyệt
   * chặn hẳn event loop nên trong lúc nó mở không có JS nào chạy — nhưng trong
   * lúc chờ `/api/jobs` thì selection dời được.
   */
  function stubWithPendingJobs() {
    const pendingJobs: (() => void)[] = []
    const fetchMock = vi.fn(async (input: any, init: any = {}) => {
      const url = String(input)
      const isGet = String(init.method ?? 'GET').toUpperCase() === 'GET'
      if (url.includes('/api/jobs')) {
        return new Promise((resolve) => {
          pendingJobs.push(() => resolve(jsonRes({ jobs: [] })))
        })
      }
      if (url.includes('/worktree') && isGet) return worktreeOk(cleanWorktree)
      if (url.includes('/api/tasks/')) return jsonRes({ ok: true })
      throw new Error(`unexpected fetch: ${init.method ?? 'GET'} ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn(() => true))
    return { fetchMock, releaseJobs: () => pendingJobs.forEach((r) => r()) }
  }

  it('đổi project trong lúc soạn câu xác nhận: không gửi DELETE nào', async () => {
    const { fetchMock, releaseJobs } = stubWithPendingJobs()
    const w = mountLayout({
      tasks,
      selected: completed,
      selectedId: 'B4488',
      selectedProjectId: 'proj-1',
    })
    await flushPromises()

    void w.find('.badges .btn-clean-worktree').trigger('click')
    await flushPromises()
    await w.setProps({ selectedProjectId: 'proj-2' })
    releaseJobs()
    await flushPromises()

    expect(deleteCalls(fetchMock).length).toBe(0)
  })

  it('đổi task trong lúc soạn câu xác nhận: không gửi DELETE nào', async () => {
    const { fetchMock, releaseJobs } = stubWithPendingJobs()
    const w = mountLayout({
      tasks,
      selected: completed,
      selectedId: 'B4488',
      selectedProjectId: 'proj-1',
    })
    await flushPromises()

    void w.find('.badges .btn-clean-worktree').trigger('click')
    await flushPromises()
    await w.setProps({
      selected: { ...tasks[1], current_phase: 'completed' },
      selectedId: 'F003',
    })
    releaseJobs()
    await flushPromises()

    expect(deleteCalls(fetchMock).length).toBe(0)
  })

  it('đổi project đọc lại trạng thái worktree, không giữ badge của project cũ', async () => {
    let call = 0
    stubFetch({
      worktreeResponse: () => {
        call += 1
        return call === 1 ? worktreeOk(cleanWorktree) : worktreeOk(null)
      },
    })

    const w = mountLayout({
      tasks,
      selected: completed,
      selectedId: 'B4488',
      selectedProjectId: 'proj-1',
    })
    await flushPromises()
    expect(w.find('.badges .badge.worktree').exists()).toBe(true)

    await w.setProps({ selectedProjectId: 'proj-2' })
    await flushPromises()

    expect(call).toBe(2)
    expect(w.find('.badges .badge.worktree').exists()).toBe(false)
  })

  /**
   * Poll 1.5s thay `selected` bằng một object mới **cùng giá trị** mỗi nhịp. Nếu
   * watch so theo identity (một getter trả array literal) thì mỗi nhịp poll xoá
   * sạch `worktreeError` và bắn thêm một GET /worktree — người dùng không kịp
   * đọc lý do bị từ chối, còn server ăn thêm một `git status` mỗi 1.5s.
   */
  it('prop selected mới cùng giá trị: không đọc lại worktree, không xoá thông báo lỗi', async () => {
    let gets = 0
    stubFetch({
      worktreeResponse: () => {
        gets += 1
        return worktreeOk(cleanWorktree)
      },
      deleteResponse: {
        ok: false,
        status: 409,
        json: async () => ({ error: 'worktree_detached' }),
      },
    })
    vi.stubGlobal('confirm', vi.fn(() => true))

    const w = mountLayout({
      tasks,
      selected: completed,
      selectedId: 'B4488',
      selectedProjectId: 'proj-1',
    })
    await flushPromises()
    await w.find('.badges .btn-clean-worktree').trigger('click')
    await flushPromises()

    const shownError = () => w.find('.task-head .art-warning').text()
    expect(shownError()).toBe(viMonitor.layout.worktreeErrDetached)
    const getsBeforePoll = gets

    // Một nhịp poll: object khác, giá trị y hệt.
    await w.setProps({ selected: { ...completed } })
    await flushPromises()

    expect(gets).toBe(getsBeforePoll)
    expect(shownError()).toBe(viMonitor.layout.worktreeErrDetached)
  })
})

// Repo không có test đối chiếu key vi ↔ en, nên chuỗi mới phải tự khoá ở đây:
// thiếu bên `en` sẽ im lặng fallback về `vi` và lọt qua mọi suite khác.
describe('MonitorLayout — chuỗi worktree mới có ở cả hai locale', () => {
  it.each(['worktreeErrDetached', 'worktreeErrJobInFlight'] as const)(
    '%s có ở vi và en, và hai bên khác chữ',
    (key) => {
      for (const messages of [viMonitor, enMonitor]) {
        expect(typeof (messages.layout as any)[key]).toBe('string')
        expect((messages.layout as any)[key].length).toBeGreaterThan(0)
      }
      expect((enMonitor.layout as any)[key]).not.toBe((viMonitor.layout as any)[key])
    },
  )

  it.each(['cleanWorktreeTitle', 'confirmCleanWorktree', 'confirmCleanWorktreeRunning'] as const)(
    '%s không còn khẳng định giữ được "mọi commit" nói chung',
    (key) => {
      // Xoá worktree chỉ giữ những commit đã nằm trên branch; commit chỉ có ở
      // HEAD detached thì không. Câu cũ nói quá phạm vi đó.
      expect((viMonitor.layout as any)[key]).toContain('đã nằm trên branch đó')
      expect((enMonitor.layout as any)[key]).toContain('already on that branch')
    },
  )
})
