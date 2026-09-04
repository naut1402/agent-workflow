import { mountWithI18n as mount } from '../../../helpers/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import TaskList from '@/features/monitor/components/TaskList.vue'
import { STORAGE_KEY, useAppSettings } from '@/core/composables/useAppSettings'

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

  it('shows a delete button (and the error icon/color) only for a task with state_ok: false (mục 5)', () => {
    const w = mount(TaskList, {
      props: {
        tasks: [
          { ...tasks[0], state_ok: false },
          { ...tasks[1] }, // state_ok: true, no delete button
        ],
      },
    })
    const buttons = w.findAll('.btn-delete')
    expect(buttons.length).toBe(1)
    expect(w.findAll('.flag.error').length).toBe(1)
    expect(w.findAll('.id.id-error').length).toBe(1)
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
})
