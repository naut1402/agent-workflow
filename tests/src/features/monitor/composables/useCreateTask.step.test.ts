import { describe, expect, it, vi } from 'vitest'

vi.mock('@/features/monitor/MonitorApi', () => ({
  createTask: vi.fn(),
  fetchGithubIssue: vi.fn(),
}))

vi.mock('@/features/pipeline-editor/PipelineEditorApi', () => ({
  fetchPipelineProfile: vi.fn(),
  fetchPipelineProfiles: vi.fn(),
}))

vi.mock('@/features/runner/RunnerApi', () => ({
  fetchRunners: vi.fn(),
}))

import { CREATE_TASK_STEPS, useCreateTask } from '@/features/monitor/composables/useCreateTask'

function setup() {
  return useCreateTask({ getProjectId: () => 'p1' })
}

/** Satisfy the only real gate (step 1) so forward jumps open up. */
function fillSourceStep(c: ReturnType<typeof setup>) {
  c.form.value.taskId = 'F0010'
  c.form.value.source = 'prompt'
  c.form.value.prompt = 'Do the thing'
}

describe('useCreateTask — maxReachableStep', () => {
  it('pins to step 1 while the source step is unsatisfied', () => {
    const c = setup()
    expect(c.maxReachableStep.value).toBe(1)

    c.form.value.taskId = 'F0010' // id alone is not enough — prompt still empty
    expect(c.maxReachableStep.value).toBe(1)
  })

  it('opens every step once task id and prompt are present', () => {
    const c = setup()
    fillSourceStep(c)
    expect(c.maxReachableStep.value).toBe(CREATE_TASK_STEPS)
  })

  it('opens on the issue tab as soon as a URL is entered', () => {
    const c = setup()
    c.form.value.taskId = 'F0010'
    c.form.value.source = 'issue'
    expect(c.maxReachableStep.value).toBe(1)

    c.form.value.issueUrl = 'https://github.com/o/r/issues/1'
    expect(c.maxReachableStep.value).toBe(CREATE_TASK_STEPS)
  })

  it('closes again if the task id becomes invalid', () => {
    const c = setup()
    fillSourceStep(c)
    c.form.value.taskId = 'not a valid id!'
    expect(c.maxReachableStep.value).toBe(1)
  })
})

describe('useCreateTask — goToStep', () => {
  it('jumps forward past the optional steps', () => {
    const c = setup()
    fillSourceStep(c)
    expect(c.goToStep(CREATE_TASK_STEPS)).toBe(true)
    expect(c.step.value).toBe(CREATE_TASK_STEPS)
  })

  it('refuses a forward jump while the source step is unsatisfied', () => {
    const c = setup()
    expect(c.goToStep(4)).toBe(false)
    expect(c.step.value).toBe(1)
  })

  it('always allows backward navigation', () => {
    const c = setup()
    fillSourceStep(c)
    c.goToStep(4)
    // Break the gate: going back must still work, otherwise the user is trapped.
    c.form.value.prompt = ''
    expect(c.maxReachableStep.value).toBe(1)
    expect(c.goToStep(2)).toBe(true)
    expect(c.step.value).toBe(2)
  })

  it('rejects out-of-range and no-op targets', () => {
    const c = setup()
    fillSourceStep(c)
    expect(c.goToStep(0)).toBe(false)
    expect(c.goToStep(CREATE_TASK_STEPS + 1)).toBe(false)
    expect(c.goToStep(1.5)).toBe(false)
    expect(c.goToStep(1)).toBe(false) // already on step 1
    expect(c.step.value).toBe(1)
  })

  it('resets back to step 1', () => {
    const c = setup()
    fillSourceStep(c)
    c.goToStep(3)
    c.reset()
    expect(c.step.value).toBe(1)
    expect(c.maxReachableStep.value).toBe(1)
  })
})
