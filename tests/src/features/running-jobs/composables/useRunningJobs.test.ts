import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/runner/scripts/runnerApi', () => ({
  fetchJobs: vi.fn(),
}))

import { fetchJobs } from '@/features/runner/scripts/runnerApi'
import { useRunningJobs } from '@/features/running-jobs/composables/useRunningJobs'

const fetchJobsMock = vi.mocked(fetchJobs)

afterEach(() => {
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
    const rj = useRunningJobs(1500)
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

  it('start() polls immediately then on interval; stop() clears it', async () => {
    vi.useFakeTimers()
    fetchJobsMock.mockResolvedValue({ jobs: [] })
    const rj = useRunningJobs(1500)

    rj.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchJobsMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1500)
    expect(fetchJobsMock).toHaveBeenCalledTimes(2)

    rj.stop()
    await vi.advanceTimersByTimeAsync(3000)
    expect(fetchJobsMock).toHaveBeenCalledTimes(2)
  })
})
