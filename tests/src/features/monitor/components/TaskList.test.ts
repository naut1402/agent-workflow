import { mountWithI18n as mount } from '../../../helpers/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import TaskList from '@/features/monitor/components/TaskList.vue'
import { STORAGE_KEY, useAppSettings } from '@/core/composables/useAppSettings'
import viMonitor from '@/features/monitor/locales/vi'
import enMonitor from '@/features/monitor/locales/en'

const tasks = [
  {
    task_id: 'B4488',
    current_phase: 'designer',
    hitl_pending: null,
    has_qa: false,
    state_ok: true,
    artifacts: { 'investigate.md': { exists: true }, 'design.md': { exists: false } },
  },
  { task_id: 'F003', current_phase: null, hitl_pending: 'hitl-2', has_qa: false, state_ok: true, artifacts: {} },
]

function seedSettings(patch: Record<string, unknown> = {}) {
  localStorage.clear()
  if (Object.keys(patch).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(patch))
  const { load } = useAppSettings()
  load()
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
  const { load } = useAppSettings()
  load()
})

describe('TaskList', () => {
  it('renders one row per task with id + status icon (mục 4)', () => {
    const w = mount(TaskList, { props: { tasks } })
    expect(w.find('.tasklist-head').exists()).toBe(true)
    const ids = w.findAll('.task-entry .id').map((n) => n.text())
    expect(ids).toEqual(['B4488', 'F003'])
    // taskStatusKey: has current_phase (not completed) → active; hitl_pending → waiting
    const flags = w.findAll('.task-entry .flag').map((n) => n.text())
    expect(flags).toEqual(['▶', '⏸'])
    expect(w.find('.task-entry .phase').exists()).toBe(false)
  })

  it('emits create-task when + button is clicked', async () => {
    const w = mount(TaskList, { props: { tasks } })
    await w.find('.tasklist-head .icon-btn').trigger('click')
    expect(w.emitted('create-task')).toBeTruthy()
  })

  it('emits select + expands artifacts on row click', async () => {
    seedSettings({ hideMissingArtifacts: false })
    const w = mount(TaskList, { props: { tasks } })
    await w.find('.task-row').trigger('click')
    expect(w.emitted('select')?.[0]).toEqual(['B4488'])
    // Expanded file list shows the task artifacts.
    const files = w.findAll('.file-item .file-name').map((n) => n.text())
    expect(files).toContain('investigate.md')
    expect(files).toContain('design.md')
  })

  it('shows the pending icon when the task has no current_phase/hitl_pending/has_qa', () => {
    const w = mount(TaskList, {
      props: { tasks: [{ ...tasks[0], current_phase: null, hitl_pending: null, has_qa: false }] },
    })
    expect(w.find('.task-entry .flag').text()).toBe('○')
  })

  describe('hide missing artifacts (mục 1)', () => {
    it('hides files with exists:false by default and shows a toggle with the hidden count', async () => {
      seedSettings()
      const w = mount(TaskList, { props: { tasks } })
      await w.find('.task-row').trigger('click')

      const files = w.findAll('.file-item .file-name').map((n) => n.text())
      expect(files).toEqual(['investigate.md'])
      expect(files).not.toContain('design.md')

      const toggle = w.find('.file-list-toggle')
      expect(toggle.exists()).toBe(true)
      expect(toggle.text()).toBe('Hiện file thiếu (1)')
    })

    it('clicking the toggle reveals hidden files and persists the preference', async () => {
      seedSettings()
      const w = mount(TaskList, { props: { tasks } })
      await w.find('.task-row').trigger('click')

      await w.find('.file-list-toggle').trigger('click')

      const files = w.findAll('.file-item .file-name').map((n) => n.text())
      expect(files).toEqual(['investigate.md', 'design.md'])
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')).toMatchObject({
        hideMissingArtifacts: false,
      })
      expect(w.find('.file-list-toggle').text()).toBe('Ẩn file chưa có')
    })

    it('does not render the toggle for a task with no artifacts at all', async () => {
      seedSettings()
      const w = mount(TaskList, { props: { tasks: [tasks[1]] } })
      await w.find('.task-row').trigger('click')
      expect(w.find('.file-list-toggle').exists()).toBe(false)
    })
  })

  describe('collapseAll expose (mục 7)', () => {
    it('collapses every expanded task file list when called', async () => {
      seedSettings()
      const w = mount(TaskList, { props: { tasks } })
      await w.find('.task-row').trigger('click')
      expect(w.find('.file-list').exists()).toBe(true)

      ;(w.vm as any).collapseAll()
      await w.vm.$nextTick()

      expect(w.find('.file-list').exists()).toBe(false)
    })
  })

  it('flags a task with pending Q&A using the chat icon', () => {
    const w = mount(TaskList, { props: { tasks: [{ ...tasks[0], has_qa: true }] } })
    expect(w.find('.flag.qa').exists()).toBe(true)
    expect(w.find('.flag.qa .flag-chat').exists()).toBe(true)
    expect(w.find('.flag.qa').text()).not.toContain('Q')
  })

  it('shows the archive button for every task, regardless of current_phase', () => {
    const w = mount(TaskList, {
      props: {
        tasks: [
          { ...tasks[0], current_phase: 'completed' },
          { ...tasks[1] }, // current_phase: null, not completed
        ],
      },
    })
    const buttons = w.findAll('.btn-archive')
    expect(buttons.length).toBe(2)
  })

  it('hides the archive button when the task has no valid state file (state_ok: false)', () => {
    const w = mount(TaskList, {
      props: {
        tasks: [
          { ...tasks[0], state_ok: false },
          { ...tasks[1] }, // state_ok: true, button shown
        ],
      },
    })
    const buttons = w.findAll('.btn-archive')
    expect(buttons.length).toBe(1)
  })

  // Trước Tde5b317d nút xoá chỉ hiện khi `state_ok: false` — tức task khoẻ và
  // task đã lưu trữ (luôn state_ok) không bao giờ xoá được. Giờ nút luôn hiện;
  // phần error icon/color (mục 5) vẫn giữ nguyên điều kiện cũ.
  it('shows a delete button for every task, whatever its state (mục 5)', () => {
    const w = mount(TaskList, {
      props: {
        tasks: [
          { ...tasks[0], state_ok: false },
          { ...tasks[1] }, // state_ok: true
        ],
      },
    })
    const buttons = w.findAll('.btn-delete')
    expect(buttons.length).toBe(2)
    expect(buttons.every((b) => b.attributes('disabled') === undefined)).toBe(true)
    expect(w.findAll('.flag.error').length).toBe(1)
    expect(w.findAll('.id.id-error').length).toBe(1)
  })

  it('shows a delete button for a healthy task on its own (không phải chỉ đảo điều kiện cũ)', () => {
    const w = mount(TaskList, { props: { tasks: [{ ...tasks[1] }] } })
    expect(w.findAll('.btn-delete').length).toBe(1)
  })

  it('shows a delete button inside the archived group too', () => {
    const w = mount(TaskList, {
      props: { tasks: [{ ...tasks[0], archived: true }, { ...tasks[1] }] },
    })
    expect(w.find('.archived-group .btn-delete').exists()).toBe(true)
    expect(w.find('.tasklist--active .btn-delete').exists()).toBe(true)
  })

  it('groups archived tasks into a collapsed <details> at the bottom, hidden from the main list', () => {
    const w = mount(TaskList, {
      props: {
        tasks: [
          { ...tasks[0], current_phase: 'completed', archived: true },
          { ...tasks[1] },
        ],
      },
    })
    // Main list only shows the non-archived task.
    expect(w.find('.tasklist-panel').exists()).toBe(true)
    const mainIds = w.find('.tasklist--active').findAll('.task-entry .id').map((n) => n.text())
    expect(mainIds).toEqual(['F003'])

    // Archived group exists, collapsed by default, labelled with the count.
    const group = w.find('.archived-group')
    expect(group.exists()).toBe(true)
    expect(group.element.hasAttribute('open')).toBe(false)
    expect(group.find('summary').text()).toBe('Đã lưu trữ (1)')

    // Task is present inside the group markup (native <details> keeps content in the
    // DOM even when collapsed) — list is scrollable via .tasklist--archived.
    expect(group.find('.tasklist--archived').exists()).toBe(true)
    const archivedIds = group.findAll('.task-entry .id').map((n) => n.text())
    expect(archivedIds).toEqual(['B4488'])
  })

  it('does not render the archived group when there are no archived tasks', () => {
    const w = mount(TaskList, { props: { tasks } })
    expect(w.find('.archived-group').exists()).toBe(false)
  })

  it('clicking unarchive from inside the archived group calls patchTaskArchive and emits task-archived', async () => {
    const fetchMock = vi.fn(async (_input: any, _init: any = {}) => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'B4488' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const w = mount(TaskList, {
      props: {
        tasks: [{ ...tasks[0], archived: true, state_mtime: 123 }],
        projectId: 'proj-1',
      },
    })
    const group = w.find('.archived-group')
    await group.find('.btn-archive').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/task-archive')
    expect(String(url)).toContain('id=B4488')
    expect(String(url)).toContain('project=proj-1')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ archived: false, mtime: 123 })
    expect(w.emitted('task-archived')).toBeTruthy()
  })

  it('clicking the archive button calls patchTaskArchive and emits task-archived', async () => {
    const fetchMock = vi.fn(async (_input: any, _init: any = {}) => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'B4488' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const w = mount(TaskList, {
      props: {
        tasks: [{ ...tasks[0], current_phase: 'completed', state_mtime: 123 }],
        projectId: 'proj-1',
      },
    })
    await w.find('.btn-archive').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/task-archive')
    expect(String(url)).toContain('id=B4488')
    expect(String(url)).toContain('project=proj-1')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ archived: true, mtime: 123 })
    expect(w.emitted('task-archived')).toBeTruthy()
  })

  it('refreshes (emits task-archived) instead of erroring on a 409 conflict', async () => {
    const fetchMock = vi.fn(async (_input: any, _init: any = {}) => ({
      ok: false,
      status: 409,
      json: async () => ({ error: 'conflict' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const w = mount(TaskList, {
      props: { tasks: [{ ...tasks[0], current_phase: 'completed', state_mtime: 123 }] },
    })
    await w.find('.btn-archive').trigger('click')
    await flushPromises()

    expect(w.emitted('task-archived')).toBeTruthy()
    expect(w.find('.art-warning').exists()).toBe(false)
  })

  describe('inline rename (mục 1)', () => {
    it('dblclick .id switches to an input, blur commits the new name via patchTaskName', async () => {
      const fetchMock = vi.fn(async (_input: any, _init: any = {}) => ({
        ok: true,
        status: 200,
        json: async () => ({ id: 'B4488' }),
      }))
      vi.stubGlobal('fetch', fetchMock)

      const w = mount(TaskList, {
        props: { tasks: [{ ...tasks[0], state_mtime: 123 }], projectId: 'proj-1' },
      })
      await w.find('.task-entry .id').trigger('dblclick')
      const input = w.find('.id-rename-input')
      expect(input.exists()).toBe(true)

      await input.setValue('New task name')
      await input.trigger('blur')
      await flushPromises()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toContain('/api/task-name')
      expect(String(url)).toContain('id=B4488')
      expect(String(url)).toContain('project=proj-1')
      expect(init.method).toBe('PUT')
      expect(JSON.parse(init.body)).toEqual({ name: 'New task name', mtime: 123 })
      expect(w.emitted('task-archived')).toBeTruthy()
    })

    it('refreshes (emits task-archived) instead of erroring on a 409 rename conflict', async () => {
      const fetchMock = vi.fn(async (_input: any, _init: any = {}) => ({
        ok: false,
        status: 409,
        json: async () => ({ error: 'conflict' }),
      }))
      vi.stubGlobal('fetch', fetchMock)

      const w = mount(TaskList, { props: { tasks: [{ ...tasks[0], state_mtime: 123 }] } })
      await w.find('.task-entry .id').trigger('dblclick')
      const input = w.find('.id-rename-input')
      await input.setValue('New task name')
      await input.trigger('blur')
      await flushPromises()

      expect(w.emitted('task-archived')).toBeTruthy()
      expect(w.find('.art-warning').exists()).toBe(false)
    })

    it('Escape cancels rename without calling the API', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      const w = mount(TaskList, { props: { tasks: [{ ...tasks[0], state_mtime: 123 }] } })
      await w.find('.task-entry .id').trigger('dblclick')
      const input = w.find('.id-rename-input')
      await input.setValue('New task name')
      await input.trigger('keyup.escape')

      expect(w.find('.id-rename-input').exists()).toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('Escape cancels rename even when the DOM removal fires a native blur afterwards', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      const w = mount(TaskList, {
        props: { tasks: [{ ...tasks[0], state_mtime: 123 }] },
        attachTo: document.body,
      })
      await w.find('.task-entry .id').trigger('dblclick')
      const input = w.find('.id-rename-input')
      const inputEl = input.element as HTMLInputElement
      inputEl.focus()
      await input.setValue('New task name')
      await input.trigger('keyup.escape')

      expect(w.find('.id-rename-input').exists()).toBe(false)
      // Simulate the browser's native blur, fired when a focused element is removed from the DOM.
      inputEl.dispatchEvent(new Event('blur'))
      await flushPromises()

      expect(fetchMock).not.toHaveBeenCalled()
      w.unmount()
    })

    it('no-op (no API call) when the name is unchanged or blank after trim', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      const w = mount(TaskList, { props: { tasks: [{ ...tasks[0], state_mtime: 123 }] } })
      await w.find('.task-entry .id').trigger('dblclick')
      await w.find('.id-rename-input').trigger('blur')
      await flushPromises()

      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
  // Nút xoá đi kèm confirm bắt buộc, và message đổi khi task còn job sống —
  // handler async (dò /api/jobs trước) nên mọi case phải flushPromises().
  describe('delete task (Tde5b317d)', () => {
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

    it('asks for confirmation and deletes, emitting task-deleted', async () => {
      const fetchMock = stubFetch()
      const confirmMock = vi.fn(() => true)
      vi.stubGlobal('confirm', confirmMock)

      const w = mount(TaskList, { props: { tasks: [tasks[0]], projectId: 'proj-1' } })
      await w.find('.btn-delete').trigger('click')
      await flushPromises()

      expect(confirmMock).toHaveBeenCalledWith(viMonitor.taskItem.confirmDelete)
      const calls = deleteCalls(fetchMock)
      expect(calls.length).toBe(1)
      expect(String(calls[0][0])).toContain('/api/tasks/B4488')
      expect(String(calls[0][0])).toContain('project=proj-1')
      expect(w.emitted('task-deleted')?.[0]).toEqual(['B4488'])
    })

    // Không có @task-deleted trên vòng lặp nhóm archived thì hàng vẫn nằm lại
    // trên màn hình cho tới lần poll sau — case này chết đúng ở đó.
    it('deletes from inside the archived group and bubbles task-deleted up', async () => {
      const fetchMock = stubFetch()
      vi.stubGlobal('confirm', vi.fn(() => true))

      const w = mount(TaskList, {
        props: { tasks: [{ ...tasks[0], archived: true }], projectId: 'proj-1' },
      })
      await w.find('.archived-group .btn-delete').trigger('click')
      await flushPromises()

      const calls = deleteCalls(fetchMock)
      expect(calls.length).toBe(1)
      expect(String(calls[0][0])).toContain('/api/tasks/B4488')
      expect(String(calls[0][0])).toContain('project=proj-1')
      expect(w.emitted('task-deleted')?.[0]).toEqual(['B4488'])
    })

    it('warns with a stronger message when the task still has a running job', async () => {
      stubFetch({ jobs: { running: [{ metadata: { taskId: 'B4488', projectId: 'proj-1' } }] } })
      const confirmMock = vi.fn(() => true)
      vi.stubGlobal('confirm', confirmMock)

      const w = mount(TaskList, { props: { tasks: [tasks[0]], projectId: 'proj-1' } })
      await w.find('.btn-delete').trigger('click')
      await flushPromises()

      expect(confirmMock).toHaveBeenCalledWith(viMonitor.taskItem.confirmDeleteRunning)
      expect(viMonitor.taskItem.confirmDeleteRunning).not.toBe(viMonitor.taskItem.confirmDelete)
    })

    it('warns for a queued job as well', async () => {
      stubFetch({ jobs: { queued: [{ metadata: { taskId: 'B4488' } }] } })
      const confirmMock = vi.fn(() => true)
      vi.stubGlobal('confirm', confirmMock)

      const w = mount(TaskList, { props: { tasks: [tasks[0]], projectId: 'proj-1' } })
      await w.find('.btn-delete').trigger('click')
      await flushPromises()

      expect(confirmMock).toHaveBeenCalledWith(viMonitor.taskItem.confirmDeleteRunning)
    })

    it('does not warn for a live job of another task', async () => {
      stubFetch({ jobs: { running: [{ metadata: { taskId: 'F003', projectId: 'proj-1' } }] } })
      const confirmMock = vi.fn(() => true)
      vi.stubGlobal('confirm', confirmMock)

      const w = mount(TaskList, { props: { tasks: [tasks[0]], projectId: 'proj-1' } })
      await w.find('.btn-delete').trigger('click')
      await flushPromises()

      expect(confirmMock).toHaveBeenCalledWith(viMonitor.taskItem.confirmDelete)
    })

    it('cancelling the confirm sends nothing and emits nothing', async () => {
      const fetchMock = stubFetch()
      vi.stubGlobal('confirm', vi.fn(() => false))

      const w = mount(TaskList, { props: { tasks: [tasks[0]], projectId: 'proj-1' } })
      await w.find('.btn-delete').trigger('click')
      await flushPromises()

      expect(deleteCalls(fetchMock).length).toBe(0)
      expect(w.emitted('task-deleted')).toBeFalsy()
      expect(w.find('.art-warning').exists()).toBe(false)
      // Nút dùng lại được ngay — confirm hiện lại ở lần bấm sau.
      expect(w.find('.btn-delete').attributes('disabled')).toBeUndefined()
    })

    it('targets the clicked row, not the selected task', async () => {
      const fetchMock = stubFetch()
      vi.stubGlobal('confirm', vi.fn(() => true))

      const w = mount(TaskList, {
        props: { tasks, selectedId: 'B4488', projectId: 'proj-1' },
      })
      await w.findAll('.btn-delete')[1].trigger('click')
      await flushPromises()

      expect(String(deleteCalls(fetchMock)[0][0])).toContain('/api/tasks/F003')
      expect(w.emitted('task-deleted')?.[0]).toEqual(['F003'])
    })

    it('double-click sends exactly one DELETE', async () => {
      const fetchMock = stubFetch()
      const confirmMock = vi.fn(() => true)
      vi.stubGlobal('confirm', confirmMock)

      const w = mount(TaskList, { props: { tasks: [tasks[0]], projectId: 'proj-1' } })
      const btn = w.find('.btn-delete')
      btn.trigger('click')
      btn.trigger('click')
      btn.trigger('click')
      await flushPromises()

      expect(confirmMock).toHaveBeenCalledTimes(1)
      expect(deleteCalls(fetchMock).length).toBe(1)
    })

    // Backend job lỗi KHÔNG được chặn xoá: vẫn hỏi (message thường) rồi xoá.
    it('still confirms and deletes when the jobs lookup fails', async () => {
      const fetchMock = vi.fn(async (input: any, init: any = {}) => {
        const url = String(input)
        if (url.includes('/api/jobs')) return { ok: false, status: 500, json: async () => ({ error: 'boom' }) }
        if (url.includes('/api/tasks/')) return { ok: true, status: 200, json: async () => ({ ok: true }) }
        throw new Error(`unexpected fetch: ${init.method ?? 'GET'} ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)
      const confirmMock = vi.fn(() => true)
      vi.stubGlobal('confirm', confirmMock)

      const w = mount(TaskList, { props: { tasks: [tasks[0]], projectId: 'proj-1' } })
      await w.find('.btn-delete').trigger('click')
      await flushPromises()

      expect(confirmMock).toHaveBeenCalledWith(viMonitor.taskItem.confirmDelete)
      expect(deleteCalls(fetchMock).length).toBe(1)
      expect(w.emitted('task-deleted')?.[0]).toEqual(['B4488'])
    })

    it('surfaces a DELETE failure and keeps the button usable', async () => {
      const fetchMock = stubFetch({
        deleteResponse: { ok: false, status: 500, json: async () => ({ error: 'nope' }) },
      })
      vi.stubGlobal('confirm', vi.fn(() => true))

      const w = mount(TaskList, { props: { tasks: [tasks[0]], projectId: 'proj-1' } })
      await w.find('.btn-delete').trigger('click')
      await flushPromises()

      expect(w.emitted('task-deleted')).toBeFalsy()
      expect(w.find('.art-warning').text()).toContain('nope')
      expect(w.find('.btn-delete').attributes('disabled')).toBeUndefined()
      expect(deleteCalls(fetchMock).length).toBe(1)
    })
  })
})

// Repo không có test đối chiếu key vi ↔ en (tests/src/core/i18n chỉ phủ
// locale/fallback/interpolation) — chuỗi cảnh báo mới phải tự khoá ở đây, nếu
// không thiếu bên `en` sẽ fallback về `vi` và lọt qua mọi suite khác.
describe('chuỗi xác nhận xoá — vi ↔ en', () => {
  it.each(['layout', 'taskItem'] as const)('namespace %s có cả hai message ở cả hai locale', (ns) => {
    for (const messages of [viMonitor, enMonitor]) {
      const bucket = messages[ns] as Record<string, string>
      expect(typeof bucket.confirmDelete).toBe('string')
      expect(typeof bucket.confirmDeleteRunning).toBe('string')
      // MSG-warn ≠ MSG-std, nếu không thì cảnh báo vô nghĩa.
      expect(bucket.confirmDeleteRunning).not.toBe(bucket.confirmDelete)
    }
    // Hai locale phải thực sự khác chữ (không copy nguyên chuỗi vi sang en).
    expect((enMonitor[ns] as any).confirmDeleteRunning).not.toBe(
      (viMonitor[ns] as any).confirmDeleteRunning,
    )
  })

  // `|` là ký tự phân tách plural của vue-i18n, `@` mở linked message — chuỗi
  // dính hai ký tự đó sẽ bị parse sai thay vì hiện nguyên văn.
  it('không dùng ký tự vue-i18n hiểu đặc biệt', () => {
    for (const messages of [viMonitor, enMonitor]) {
      for (const ns of ['layout', 'taskItem'] as const) {
        const msg = (messages[ns] as any).confirmDeleteRunning as string
        expect(msg).not.toContain('|')
        expect(msg).not.toMatch(/@[.:{]/)
        expect(msg).not.toContain('\n')
      }
    }
  })
})
