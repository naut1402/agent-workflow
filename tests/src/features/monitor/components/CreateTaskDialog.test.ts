import { mountWithI18n as mount } from '../../../helpers/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, DOMWrapper } from '@vue/test-utils'
import CreateTaskDialog from '@/features/monitor/components/CreateTaskDialog.vue'

vi.mock('@/api', () => ({
  fetchPipelineProfiles: vi.fn(async () => ({ profiles: [{ name: 'dev' }] })),
  fetchRunners: vi.fn(async () => ({ runners: [{ id: 'r1', name: 'Runner 1', enabled: true }] })),
  fetchPipelineProfile: vi.fn(async () => ({
    pipeline: { steps: [{ id: 'investigator', label: 'Investigate' }] },
  })),
  fetchGithubIssue: vi.fn(),
  createTask: vi.fn(),
}))

import { createTask, fetchGithubIssue } from '@/api'

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(CreateTaskDialog, { props, attachTo: document.body })
}

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

describe('CreateTaskDialog', () => {
  it('renders step 1 with task id and prompt tab', () => {
    mountDialog({ projectId: 'p1' })
    const root = document.querySelector('.create-task-dialog')
    expect(root).toBeTruthy()
    expect(document.body.textContent).toContain('Task ID')
    expect(document.body.textContent).toContain('Prompt')
  })

  it('blocks Next until task id and prompt are filled', async () => {
    mountDialog()
    await flushPromises()
    const buttons = [...document.querySelectorAll('button.btn-primary')]
    const nextBtn = buttons.find((b) => b.textContent?.includes('Tiếp'))
    expect(nextBtn?.hasAttribute('disabled')).toBe(true)

    const taskInput = new DOMWrapper(document.querySelector('.create-task-body input.cfg-input')!)
    await taskInput.setValue('F0010')
    const prompt = new DOMWrapper(document.querySelector('.create-task-body textarea')!)
    await prompt.setValue('Do the thing')
    await flushPromises()

    expect(nextBtn?.hasAttribute('disabled')).toBe(false)
  })

  it('walks through to preview and calls createTask on submit', async () => {
    vi.mocked(createTask).mockResolvedValue({
      task: { taskId: 'F0010' },
    })

    const w = mountDialog({ projectId: 'p1' })
    await flushPromises()

    const taskInput = new DOMWrapper(document.querySelector('.create-task-body input.cfg-input')!)
    await taskInput.setValue('F0010')
    const prompt = new DOMWrapper(document.querySelector('.create-task-body textarea')!)
    await prompt.setValue('Brief')
    await flushPromises()

    const clickPrimary = (label: string) => {
      const btn = [...document.querySelectorAll('button.btn-primary')].find((b) =>
        b.textContent?.includes(label),
      )
      if (btn instanceof HTMLButtonElement) btn.click()
    }

    clickPrimary('Tiếp')
    await flushPromises()
    clickPrimary('Tiếp')
    await flushPromises()
    clickPrimary('Tiếp')
    await flushPromises()

    expect(document.body.textContent).toContain('F0010')

    clickPrimary('Tạo task')
    await flushPromises()

    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'F0010', prompt: 'Brief', source: 'prompt' }),
      'p1',
    )
    expect(w.emitted('created')?.[0]).toEqual([{ taskId: 'F0010', jobId: null }])
  })

  it('fetches GitHub issue on issue tab before advancing', async () => {
    vi.mocked(fetchGithubIssue).mockResolvedValue({
      issue: {
        title: 'Issue title',
        body: 'Body',
        url: 'https://github.com/o/r/issues/1',
        prompt: '# Issue title\n\nBody',
      },
    })

    mountDialog()
    await flushPromises()

    const taskInput = new DOMWrapper(document.querySelector('.create-task-body input.cfg-input')!)
    await taskInput.setValue('F0010')
    const tabs = document.querySelectorAll('.create-task-tab')
    ;(tabs[1] as HTMLButtonElement).click()
    await flushPromises()

    const urlInput = new DOMWrapper(document.querySelectorAll('.create-task-body input.cfg-input')[1]!)
    await urlInput.setValue('https://github.com/o/r/issues/1')
    await flushPromises()

    const fetchBtn = [...document.querySelectorAll('button.btn-ghost')].find((b) =>
      b.textContent?.includes('Tải issue'),
    )
    if (fetchBtn instanceof HTMLButtonElement) fetchBtn.click()
    await flushPromises()

    expect(fetchGithubIssue).toHaveBeenCalled()
    const promptEl = document.querySelector('.create-task-body textarea') as HTMLTextAreaElement
    expect(promptEl?.value).toContain('Issue title')
  })
})
