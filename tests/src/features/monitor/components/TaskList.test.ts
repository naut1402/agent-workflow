import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
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
})
