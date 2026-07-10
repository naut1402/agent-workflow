import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import TaskList from '@/features/monitor/components/TaskList.vue'

const tasks = [
  {
    task_id: 'B4488',
    current_phase: 'designer',
    hitl_pending: null,
    has_qa: false,
    artifacts: { 'investigate.md': { exists: true }, 'design.md': { exists: false } },
  },
  { task_id: 'F003', current_phase: null, hitl_pending: 'hitl-2', has_qa: false, artifacts: {} },
]

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('TaskList', () => {
  it('renders one row per task with id + phase label', () => {
    const w = mount(TaskList, { props: { tasks } })
    const ids = w.findAll('.task-entry .id').map((n) => n.text())
    expect(ids).toEqual(['B4488', 'F003'])
    // phaseLabel: current_phase when present, else hitl_pending
    const phases = w.findAll('.task-entry .phase').map((n) => n.text())
    expect(phases).toEqual(['designer', 'hitl-2'])
  })

  it('emits select + expands artifacts on row click', async () => {
    const w = mount(TaskList, { props: { tasks } })
    await w.find('.task-row').trigger('click')
    expect(w.emitted('select')?.[0]).toEqual(['B4488'])
    // Expanded file list shows the task artifacts.
    const files = w.findAll('.file-item .file-name').map((n) => n.text())
    expect(files).toContain('investigate.md')
    expect(files).toContain('design.md')
  })

  it('flags a task with pending Q&A', () => {
    const w = mount(TaskList, { props: { tasks: [{ ...tasks[0], has_qa: true }] } })
    expect(w.find('.flag.qa').exists()).toBe(true)
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
    const mainIds = w.findAll('.tasklist')[0].findAll('.task-entry .id').map((n) => n.text())
    expect(mainIds).toEqual(['F003'])

    // Archived group exists, collapsed by default, labelled with the count.
    const group = w.find('.archived-group')
    expect(group.exists()).toBe(true)
    expect(group.element.hasAttribute('open')).toBe(false)
    expect(group.find('summary').text()).toBe('Đã lưu trữ (1)')

    // Task is present inside the group markup (native <details> keeps content in the
    // DOM even when collapsed).
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
})
