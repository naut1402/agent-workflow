import { mountWithI18n as mount } from '../../../helpers/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import ProjectBar from '@/features/monitor/components/ProjectBar.vue'
import { removeProject } from '@/api'

vi.mock('@/api', () => ({
  addProject: vi.fn(async () => ({ project: { id: 'new-1', name: 'New' } })),
  removeProject: vi.fn(async () => ({ removed: true })),
}))

const projects = [
  { id: 'p-default', name: 'Default project', default: true },
  { id: 'p-other', name: 'Other project', default: false },
]

afterEach(() => {
  vi.mocked(removeProject).mockClear()
  vi.stubGlobal('confirm', undefined as any)
})

describe('ProjectBar — remove default project (mục 2)', () => {
  it('renders a remove button for the default project too', () => {
    const w = mount(ProjectBar, { props: { projects, defaultId: 'p-default', selectedId: null } })
    const items = w.findAll('.project-item')
    expect(items).toHaveLength(2)
    expect(items[0].find('.project-remove').exists()).toBe(true)
    expect(items[1].find('.project-remove').exists()).toBe(true)
  })

  it('clicking remove on the default project calls removeProject (no longer blocked)', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    const w = mount(ProjectBar, { props: { projects, defaultId: 'p-default', selectedId: null } })

    await w.findAll('.project-item')[0].find('.project-remove').trigger('click')
    await flushPromises()

    expect(removeProject).toHaveBeenCalledWith('p-default')
    expect(w.emitted('changed')).toBeTruthy()
  })

  it('shows a distinct confirm message warning about the default promotion', async () => {
    const confirmSpy = vi.fn((_message?: string) => false)
    vi.stubGlobal('confirm', confirmSpy)
    const w = mount(ProjectBar, { props: { projects, defaultId: 'p-default', selectedId: null } })

    await w.findAll('.project-item')[0].find('.project-remove').trigger('click')

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(String(confirmSpy.mock.calls[0][0])).toContain('mặc định')
    expect(removeProject).not.toHaveBeenCalled()
  })

  it('cancelling the confirm on a non-default project does not call removeProject', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    const w = mount(ProjectBar, { props: { projects, defaultId: 'p-default', selectedId: null } })

    await w.findAll('.project-item')[1].find('.project-remove').trigger('click')

    expect(removeProject).not.toHaveBeenCalled()
  })
})
