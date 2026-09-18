import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/runner/scripts/runnerApi', () => ({
  fetchJobs: vi.fn(),
}))

import { fetchJobs } from '@/features/runner/scripts/runnerApi'
import { useRunningJobs } from '@/features/running-jobs/composables/useRunningJobs'
import { makeSseStream } from '../../../helpers/sseStream'

const fetchJobsMock = vi.mocked(fetchJobs)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('useRunningJobs', () => {
  it('poll() loads running jobs and derives count/groups', async () => {
    fetchJobsMock.mockResolvedValueOnce({
      jobs: [
        { id: 'a', status: 'running', metadata: { taskId: 'T1', stepId: 's1' } },
        { id: 'b', status: 'running', metadata: { taskId: 'T1', stepId: 's1' } },
      ],
    })
    const rj = useRunningJobs()
    await rj.poll()
    expect(fetchJobsMock).toHaveBeenCalledWith({ status: 'running' })
    expect(rj.runningCount.value).toBe(2)
    expect(rj.grouped.value.groups).toHaveLength(1)
    expect(rj.error.value).toBeNull()
  })

  it('keeps previous jobs when a poll fails', async () => {
    fetchJobsMock.mockResolvedValueOnce({
      jobs: [{ id: 'a', status: 'running', metadata: { taskId: 'T1' } }],
    })
    const rj = useRunningJobs()
    await rj.poll()
    expect(rj.runningCount.value).toBe(1)

    fetchJobsMock.mockRejectedValueOnce(new Error('network'))
    await rj.poll()
    expect(rj.runningCount.value).toBe(1)
    expect(rj.error.value).toContain('network')
  })

  it('start() opens the SSE stream (global, no project) and applies the jobs snapshot', async () => {
    const sse = makeSseStream()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => ({ ok: true, body: sse.stream }))
    vi.stubGlobal('fetch', fetchMock)
    const rj = useRunningJobs()

    rj.start()
    await vi.waitUntil(() => fetchMock.mock.calls.length > 0)
    const [input] = fetchMock.mock.calls[0]!
    expect(String(input)).toContain('/api/jobs/stream')
    expect(String(input)).not.toContain('project=')

    sse.push('jobs', { jobs: [{ id: 'a', status: 'running', metadata: { taskId: 'T1' } }] })
    await vi.waitUntil(() => rj.jobs.value.length > 0)
    expect(rj.runningCount.value).toBe(1)

    rj.stop()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('one job finishing removes only that job, the other keeps running', async () => {
    const sse = makeSseStream()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, body: sse.stream })))
    const rj = useRunningJobs()

    rj.start()
    sse.push('jobs', {
      jobs: [
        { id: 'a', status: 'running', metadata: { taskId: 'T1' } },
        { id: 'b', status: 'running', metadata: { taskId: 'T2' } },
      ],
    })
    await vi.waitUntil(() => rj.jobs.value.length === 2)

    sse.push('jobs', { jobs: [{ id: 'b', status: 'running', metadata: { taskId: 'T2' } }] })
    await vi.waitUntil(() => rj.jobs.value.length === 1)
    expect(rj.jobs.value[0].id).toBe('b')

    rj.stop()
  })

  it('ignores frames of an unrelated event type', async () => {
    const sse = makeSseStream()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, body: sse.stream })))
    const rj = useRunningJobs()

    rj.start()
    sse.push('tasks', { root: '/r', tasks: [] })
    await new Promise((r) => setTimeout(r, 10))
    expect(rj.jobs.value).toEqual([])

    rj.stop()
  })
})
