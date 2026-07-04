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
})
