import { afterEach, describe, expect, it, vi } from 'vitest'
import { useArtifactAction } from '@/features/monitor/composables/useArtifactAction'

// Sequence of job payloads returned by successive GET /api/jobs/:id calls.
function stubApi(runJob: any, jobStates: any[]) {
  let jobCall = 0
  const fetchMock = vi.fn(async (input: any, init: any = {}) => {
    const url = String(input)
    const method = (init.method || 'GET').toUpperCase()
    if (url.includes('/api/artifact-actions/run') && method === 'POST') {
      if (runJob === null) return { ok: false, status: 500, json: async () => ({ error: 'boom' }) }
      return { ok: true, status: 201, json: async () => ({ job: runJob }) }
    }
    if (url.includes('/api/jobs/')) {
      const job = jobStates[Math.min(jobCall, jobStates.length - 1)]
      jobCall += 1
      return { ok: true, status: 200, json: async () => ({ job }) }
    }
    throw new Error(`unexpected fetch: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useArtifactAction', () => {
  it('submits, polls until succeeded, then reloads', async () => {
    stubApi({ id: 'job1', status: 'queued' }, [
      { id: 'job1', status: 'running' },
      { id: 'job1', status: 'succeeded' },
    ])
    const onReload = vi.fn()
    const a = useArtifactAction({ getProjectId: () => null, onReload, pollMs: 1 })

    await a.run('T1', 'improve-doc', 'design.md')

    expect(a.lastJobId.value).toBe('job1')
    expect(onReload).toHaveBeenCalledTimes(1)
    expect(a.error.value).toBeNull()
    expect(a.runningActionId.value).toBeNull()
  })

  it('hands off to onAwaitingApproval (no reload, no error) when a require_approval job settles', async () => {
    stubApi({ id: 'job-appr', status: 'queued' }, [
      { id: 'job-appr', status: 'running' },
      { id: 'job-appr', status: 'awaiting_approval' },
    ])
    const onReload = vi.fn()
    const onAwaitingApproval = vi.fn()
    const a = useArtifactAction({ getProjectId: () => null, onReload, onAwaitingApproval, pollMs: 1 })

    await a.run('T1', 'improve-doc', 'design.md')

    expect(onReload).not.toHaveBeenCalled()
    expect(a.error.value).toBeNull()
    const expected = { jobId: 'job-appr', target: { taskId: 'T1', name: 'design.md' } }
    expect(onAwaitingApproval).toHaveBeenCalledWith(expected)
    expect(a.pendingApproval.value).toEqual(expected)
    expect(a.runningActionId.value).toBeNull()
  })

  it('surfaces a message and skips reload when the job fails', async () => {
    stubApi({ id: 'job2', status: 'queued' }, [{ id: 'job2', status: 'failed', error: 'runner disabled' }])
    const onReload = vi.fn()
    const a = useArtifactAction({ getProjectId: () => null, onReload, pollMs: 1 })

    await a.run('T1', 'improve-doc', 'design.md')

    expect(onReload).not.toHaveBeenCalled()
    expect(a.error.value).toContain('runner disabled')
    expect(a.runningActionId.value).toBeNull()
  })

  it('surfaces the error when the submit request fails', async () => {
    stubApi(null, [])
    const onReload = vi.fn()
    const a = useArtifactAction({ getProjectId: () => null, onReload, pollMs: 1 })

    await a.run('T1', 'improve-doc', 'design.md')

    expect(onReload).not.toHaveBeenCalled()
    expect(a.error.value).toBe('boom')
  })

  it('ignores a second run while one is in flight', async () => {
    stubApi({ id: 'job3', status: 'queued' }, [{ id: 'job3', status: 'succeeded' }])
    const onReload = vi.fn()
    const a = useArtifactAction({ getProjectId: () => null, onReload, pollMs: 1 })

    const first = a.run('T1', 'improve-doc', 'design.md')
    // runningActionId is set synchronously up to the first await; a concurrent
    // call must be a no-op.
    await a.run('T1', 'improve-doc', 'design.md')
    await first

    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('times out when the job never reaches a terminal state', async () => {
    // Job stays queued forever; maxWaitMs should end the poll with an error.
    stubApi({ id: 'job4', status: 'queued' }, [{ id: 'job4', status: 'queued' }])
    const onReload = vi.fn()
    const a = useArtifactAction({ getProjectId: () => null, onReload, pollMs: 1, maxWaitMs: 10 })

    await a.run('T1', 'improve-doc', 'design.md')

    expect(onReload).not.toHaveBeenCalled()
    expect(a.error.value).toContain('Hết thời gian chờ job')
    expect(a.runningActionId.value).toBeNull()
  })

  it('retries transient poll failures before succeeding', async () => {
    // First job poll rejects (network blip), then it recovers and succeeds.
    let jobCall = 0
    const fetchMock = vi.fn(async (input: any, init: any = {}) => {
      const url = String(input)
      const method = (init.method || 'GET').toUpperCase()
      if (url.includes('/api/artifact-actions/run') && method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ job: { id: 'job5', status: 'queued' } }) }
      }
      if (url.includes('/api/jobs/')) {
        jobCall += 1
        if (jobCall === 1) throw new Error('network blip')
        return { ok: true, status: 200, json: async () => ({ job: { id: 'job5', status: 'succeeded' } }) }
      }
      throw new Error(`unexpected fetch: ${method} ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const onReload = vi.fn()
    const a = useArtifactAction({ getProjectId: () => null, onReload, pollMs: 1, maxPollErrors: 3 })

    await a.run('T1', 'improve-doc', 'design.md')

    expect(onReload).toHaveBeenCalledTimes(1)
    expect(a.error.value).toBeNull()
  })

  it('gives up after exceeding the transient failure budget', async () => {
    const fetchMock = vi.fn(async (input: any, init: any = {}) => {
      const url = String(input)
      const method = (init.method || 'GET').toUpperCase()
      if (url.includes('/api/artifact-actions/run') && method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ job: { id: 'job6', status: 'queued' } }) }
      }
      if (url.includes('/api/jobs/')) throw new Error('persistent outage')
      throw new Error(`unexpected fetch: ${method} ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const onReload = vi.fn()
    const a = useArtifactAction({ getProjectId: () => null, onReload, pollMs: 1, maxPollErrors: 2 })

    await a.run('T1', 'improve-doc', 'design.md')

    expect(onReload).not.toHaveBeenCalled()
    expect(a.error.value).toContain('persistent outage')
  })

  it('scopes the running action to its own artifact', async () => {
    stubApi({ id: 'job7', status: 'queued' }, [{ id: 'job7', status: 'queued' }])
    const a = useArtifactAction({ getProjectId: () => null, onReload: vi.fn(), pollMs: 1, maxWaitMs: 50 })

    const running = a.run('T1', 'improve-doc', 'design.md')

    // While in flight, the running action is reported only for its own artifact.
    expect(a.runningActionFor('T1', 'design.md')).toBe('improve-doc')
    expect(a.runningActionFor('T1', 'investigate.md')).toBeNull()
    await running
  })

  it('forwards selectedText and runnerId to the run request body', async () => {
    const fetchMock = vi.fn(async (input: any, init: any = {}) => {
      const url = String(input)
      const method = (init.method || 'GET').toUpperCase()
      if (url.includes('/api/artifact-actions/run') && method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ job: { id: 'job8', status: 'queued' } }) }
      }
      if (url.includes('/api/jobs/')) {
        return { ok: true, status: 200, json: async () => ({ job: { id: 'job8', status: 'succeeded' } }) }
      }
      throw new Error(`unexpected fetch: ${method} ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const a = useArtifactAction({ getProjectId: () => null, onReload: vi.fn(), pollMs: 1 })
    await a.run('T1', 'explain-selection', 'design.md', {
      selectedText: 'đoạn bôi đen',
      runnerId: 'r1',
    })

    const runCall = fetchMock.mock.calls.find(([input]: any) => String(input).includes('/run'))
    const body = JSON.parse(runCall![1].body)
    expect(body).toEqual({
      taskId: 'T1',
      actionId: 'explain-selection',
      artifactName: 'design.md',
      runnerId: 'r1',
      selectedText: 'đoạn bôi đen',
    })
  })
})
