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

  it('shows the archive button only for completed (or already archived) tasks', () => {
    const w = mount(TaskList, {
      props: {
        tasks: [
          { ...tasks[0], current_phase: 'completed' },
          { ...tasks[1] },
        ],
      },
    })
    const buttons = w.findAll('.btn-archive')
    expect(buttons.length).toBe(1)
  })

  it('hides archived tasks by default, shows them when "Hiện task đã lưu trữ" is ticked', async () => {
    const w = mount(TaskList, {
      props: {
        tasks: [
          { ...tasks[0], current_phase: 'completed', archived: true },
          { ...tasks[1] },
        ],
      },
    })
    expect(w.findAll('.task-entry').length).toBe(1)
    expect(w.find('.task-entry .id').text()).toBe('F003')

    await w.find('.archive-filter input').setValue(true)
    expect(w.findAll('.task-entry').length).toBe(2)
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
