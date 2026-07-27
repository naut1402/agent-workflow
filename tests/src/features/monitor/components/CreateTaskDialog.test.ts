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

  it('locks stepper jumps until task id and prompt are filled', async () => {
    mountDialog()
    await flushPromises()

    const stepBtns = () => [...document.querySelectorAll('.wizard-stepper-btn')]
    expect(stepBtns()).toHaveLength(4)
    // Step 1 is current (never navigable); 2-4 locked behind the source gate.
    expect(stepBtns().every((b) => b.hasAttribute('disabled'))).toBe(true)

    const taskInput = new DOMWrapper(document.querySelector('.create-task-body input.cfg-input')!)
    await taskInput.setValue('F0010')
    const prompt = new DOMWrapper(document.querySelector('.create-task-body textarea')!)
    await prompt.setValue('Brief')
    await flushPromises()

    expect(stepBtns()[0].hasAttribute('disabled')).toBe(true) // still the current step
    expect(stepBtns()[3].hasAttribute('disabled')).toBe(false)
  })

  it('jumps straight from source to preview via the stepper', async () => {
    mountDialog({ projectId: 'p1' })
    await flushPromises()

    const taskInput = new DOMWrapper(document.querySelector('.create-task-body input.cfg-input')!)
    await taskInput.setValue('F0010')
    const prompt = new DOMWrapper(document.querySelector('.create-task-body textarea')!)
    await prompt.setValue('Brief')
    await flushPromises()

    const previewStep = document.querySelectorAll('.wizard-stepper-btn')[3] as HTMLButtonElement
    previewStep.click()
    await flushPromises()

    // Landed on step 4: preview summary rendered and submit button available.
    expect(document.querySelector('.create-task-preview')).toBeTruthy()
    const submit = [...document.querySelectorAll('button.btn-primary')].find((b) =>
      b.textContent?.includes('Tạo task'),
    )
    expect(submit).toBeTruthy()
  })

  it('fetches the issue before a stepper jump off the issue tab', async () => {
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
    ;(document.querySelectorAll('.create-task-tab')[1] as HTMLButtonElement).click()
    await flushPromises()

    const urlInput = new DOMWrapper(
      document.querySelectorAll('.create-task-body input.cfg-input')[1]!,
    )
    await urlInput.setValue('https://github.com/o/r/issues/1')
    await flushPromises()

    // Jump forward without pressing "Tải issue" — the dialog must fetch for us,
    // otherwise preview would render an empty prompt.
    ;(document.querySelectorAll('.wizard-stepper-btn')[3] as HTMLButtonElement).click()
    await flushPromises()

    expect(fetchGithubIssue).toHaveBeenCalled()
    expect(document.body.textContent).toContain('Issue title')
  })

  it('hides the stepper once the run log is streaming', async () => {
    vi.mocked(createTask).mockResolvedValue({
      task: { taskId: 'F0010' },
      job: { id: 'job-1' },
    })

    mountDialog({ projectId: 'p1' })
    await flushPromises()

    const taskInput = new DOMWrapper(document.querySelector('.create-task-body input.cfg-input')!)
    await taskInput.setValue('F0010')
    const prompt = new DOMWrapper(document.querySelector('.create-task-body textarea')!)
    await prompt.setValue('Brief')
    await flushPromises()
    ;(document.querySelectorAll('.wizard-stepper-btn')[3] as HTMLButtonElement).click()
    await flushPromises()

    const runToggle = document.querySelector(
      '.create-task-body input[type="checkbox"]',
    ) as HTMLInputElement
    await new DOMWrapper(runToggle).setValue(true)
    await flushPromises()
    ;(
      [...document.querySelectorAll('button.btn-primary')].find((b) =>
        b.textContent?.includes('Tạo task'),
      ) as HTMLButtonElement
    ).click()
    await flushPromises()

    expect(document.querySelector('.wizard-stepper')).toBeNull()
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
