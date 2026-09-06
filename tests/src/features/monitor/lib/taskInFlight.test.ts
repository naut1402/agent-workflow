import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchJobs = vi.fn()
vi.mock('@/features/runner/scripts/runnerApi', () => ({
  fetchJobs: (...args: any[]) => fetchJobs(...args),
}))

import {
  IN_FLIGHT_JOB_STATUSES,
  hasInFlightJob,
  jobBelongsToTask,
} from '@/features/monitor/lib/taskInFlight'

function job(metadata: Record<string, unknown>) {
  return { id: 'j1', metadata }
}

/** `fetchJobs({ status })` → danh sách job của đúng status đó. */
function serveByStatus(byStatus: Record<string, any[]>) {
  fetchJobs.mockImplementation(async ({ status }: { status: string }) => ({
    jobs: byStatus[status] ?? [],
  }))
}

beforeEach(() => {
  fetchJobs.mockReset()
})

describe('jobBelongsToTask', () => {
  it('matches on taskId + same projectId', () => {
    expect(jobBelongsToTask(job({ taskId: 'B4488', projectId: 'p1' }), 'B4488', 'p1')).toBe(true)
  })

  it('rejects a job of another task', () => {
    expect(jobBelongsToTask(job({ taskId: 'F003', projectId: 'p1' }), 'B4488', 'p1')).toBe(false)
  })

  // Khớp id phải là khớp CHÍNH XÁC — `T123` không được ăn theo job của `T1234`.
  it('rejects a task id that is only a prefix of the job task id', () => {
    expect(jobBelongsToTask(job({ taskId: 'T1234' }), 'T123', null)).toBe(false)
  })

  // Job submit ở project mặc định ghi `metadata.projectId: undefined`
  // (`monitor/controller.ts`) — so sánh chặt sẽ bỏ sót đúng nhóm này.
  it('matches when the job carries no projectId (default project)', () => {
    expect(jobBelongsToTask(job({ taskId: 'B4488' }), 'B4488', 'p1')).toBe(true)
    expect(jobBelongsToTask(job({ taskId: 'B4488', projectId: '' }), 'B4488', 'p1')).toBe(true)
  })

  it('matches when the UI has no projectId selected', () => {
    expect(jobBelongsToTask(job({ taskId: 'B4488', projectId: 'p1' }), 'B4488', null)).toBe(true)
  })

  it('rejects a same-id task from another project', () => {
    expect(jobBelongsToTask(job({ taskId: 'B4488', projectId: 'p1' }), 'B4488', 'p2')).toBe(false)
  })

  it('tolerates a missing job / missing metadata', () => {
    expect(jobBelongsToTask(null, 'B4488', 'p1')).toBe(false)
    expect(jobBelongsToTask({}, 'B4488', 'p1')).toBe(false)
  })
})

describe('hasInFlightJob', () => {
  it('queries both live statuses and reports a running job', async () => {
    serveByStatus({ running: [job({ taskId: 'B4488', projectId: 'p1' })] })

    await expect(hasInFlightJob('B4488', 'p1')).resolves.toBe(true)
    expect(fetchJobs).toHaveBeenCalledTimes(2)
    const statuses = fetchJobs.mock.calls.map(([arg]) => arg.status)
    expect(statuses).toEqual([...IN_FLIGHT_JOB_STATUSES])
  })

  it('reports a queued job as in-flight too', async () => {
    serveByStatus({ queued: [job({ taskId: 'B4488', projectId: 'p1' })] })
    await expect(hasInFlightJob('B4488', 'p1')).resolves.toBe(true)
  })

  it('is false when the only jobs belong to another task or another project', async () => {
    serveByStatus({
      running: [job({ taskId: 'F003', projectId: 'p1' })],
      queued: [job({ taskId: 'B4488', projectId: 'p2' })],
    })
    await expect(hasInFlightJob('B4488', 'p1')).resolves.toBe(false)
  })

  it('is false when there is no live job at all', async () => {
    serveByStatus({})
    await expect(hasInFlightJob('B4488', 'p1')).resolves.toBe(false)
  })

  // allSettled: một status lỗi vẫn để status còn lại cảnh báo được.
  it('still warns when one of the two queries fails', async () => {
    fetchJobs.mockImplementation(async ({ status }: { status: string }) => {
      if (status === 'running') throw new Error('boom')
      return { jobs: [job({ taskId: 'B4488', projectId: 'p1' })] }
    })
    await expect(hasInFlightJob('B4488', 'p1')).resolves.toBe(true)
  })

  // Best-effort: backend hỏng KHÔNG được chặn xoá — nút xoá là lối thoát cuối.
  it('is false (never throws) when every query fails', async () => {
    fetchJobs.mockRejectedValue(new Error('network down'))
    await expect(hasInFlightJob('B4488', 'p1')).resolves.toBe(false)
  })

  it('is false on a malformed payload', async () => {
    fetchJobs.mockResolvedValue({ jobs: 'nope' })
    await expect(hasInFlightJob('B4488', 'p1')).resolves.toBe(false)
  })

  it('short-circuits without any request when the task id is empty', async () => {
    await expect(hasInFlightJob('', 'p1')).resolves.toBe(false)
    expect(fetchJobs).not.toHaveBeenCalled()
  })

  // `awaiting_recovery` là status hợp lệ của job nhưng `GET /api/jobs?status=`
  // từ chối nó (allow-list của `listOrGetJobs`) ⇒ known limitation, không query.
  it('does not query statuses the jobs endpoint rejects', async () => {
    serveByStatus({})
    await hasInFlightJob('B4488', 'p1')
    const statuses = fetchJobs.mock.calls.map(([arg]) => arg.status)
    expect(statuses).not.toContain('awaiting_recovery')
    expect(statuses).not.toContain('awaiting_approval')
  })
})
