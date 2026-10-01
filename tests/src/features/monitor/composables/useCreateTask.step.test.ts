import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/monitor/scripts/CreateTaskDialogApi', () => ({
  createTask: vi.fn(),
  fetchGithubIssue: vi.fn(),
}))

vi.mock('@/features/pipeline-editor/scripts/ProfileManagerApi', () => ({
  fetchPipelineProfile: vi.fn(),
  fetchPipelineProfiles: vi.fn(),
}))

vi.mock('@/features/runner/scripts/runnerApi', () => ({
  fetchRunners: vi.fn(),
}))

import { CREATE_TASK_STEPS, useCreateTask } from '@/features/monitor/composables/useCreateTask'
import { createTask } from '@/features/monitor/scripts/CreateTaskDialogApi'

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

/** Cổng mở bằng tay — giữ request tạo task treo mà không cần fake timer. */
function gate() {
  let release!: () => void
  const p = new Promise<void>((r) => {
    release = r
  })
  return { wait: () => p, release }
}

describe('useCreateTask — TC-24 · vòng đời cờ `loading` sau khi gỡ dòng reset tay', () => {
  afterEach(() => {
    vi.mocked(createTask).mockReset()
  })

  it('chạy được lượt thứ hai, và reset() vẫn dọn phần việc nó vẫn gánh', async () => {
    vi.mocked(createTask).mockResolvedValue({ task: { taskId: 'F0010' }, job: null } as any)
    const c = setup()
    fillSourceStep(c)

    expect(await c.submit()).toEqual({ taskId: 'F0010', jobId: null })
    expect(c.loading.value).toBe(false)

    // `reset()` thôi đụng vào `loading` (vòng đời cờ do `run` sở hữu). Nếu
    // `finally` của hook không nhả cờ thì guard chặn đúng ở đây.
    expect(await c.submit()).toEqual({ taskId: 'F0010', jobId: null })
    expect(createTask).toHaveBeenCalledTimes(2)
    expect(c.loading.value).toBe(false)

    // …và phần việc mà dòng reset tay cũ đang gánh CÙNG CHỖ phải vẫn còn: xoá
    // một dòng ngoài `try/finally` mà không có ca này là thay đổi im lặng.
    c.goToStep(3)
    c.reset()
    expect(c.step.value).toBe(1)
    expect(c.form.value.taskId).toBe('')
    expect(c.form.value.prompt).toBe('')
    expect(c.error.value).toBe(null)
  })

  it('bấm Tạo hai lần khi request chưa xong chỉ gửi một request', async () => {
    const g = gate()
    vi.mocked(createTask).mockImplementation(async () => {
      await g.wait()
      return { task: { taskId: 'F0010' }, job: null } as any
    })
    const c = setup()
    fillSourceStep(c)

    const first = c.submit()
    expect(c.loading.value).toBe(true)
    expect(await c.submit()).toBe(null)
    expect(createTask).toHaveBeenCalledTimes(1)

    g.release()
    expect(await first).toEqual({ taskId: 'F0010', jobId: null })
    expect(c.loading.value).toBe(false)
  })

  it('API lỗi thì nhả cờ, giữ thông điệp lỗi, và lượt sau vẫn gửi được', async () => {
    vi.mocked(createTask).mockRejectedValueOnce(new Error('409 Conflict'))
    const c = setup()
    fillSourceStep(c)

    expect(await c.submit()).toBe(null)
    expect(c.loading.value).toBe(false)
    expect(c.error.value).toContain('409 Conflict')

    vi.mocked(createTask).mockResolvedValue({ task: { taskId: 'F0010' }, job: null } as any)
    expect(await c.submit()).toEqual({ taskId: 'F0010', jobId: null })
  })
})
