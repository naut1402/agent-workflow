import { describe, expect, it } from 'vitest'
import { groupRunningJobs, LIST_TASK_CAP, type JobLite } from '@/features/running-jobs/lib/groupRunningJobs'
import { stepIdOf } from '@/features/running-jobs/lib/stepIdOf'

function job(over: Partial<JobLite> & { id: string }): JobLite {
  return {
    status: 'running',
    createdAt: '2026-01-01T00:00:00.000Z',
    metadata: {},
    ...over,
  }
}

describe('stepIdOf', () => {
  it('prefers stepId then pipelineStepId', () => {
    expect(stepIdOf({ metadata: { stepId: 'a', pipelineStepId: 'b' } })).toBe('a')
    expect(stepIdOf({ metadata: { pipelineStepId: 'b' } })).toBe('b')
    expect(stepIdOf({ metadata: {} })).toBeUndefined()
  })
})

describe('groupRunningJobs', () => {
  it('groups by task then step and keeps unknown last', () => {
    const jobs = [
      job({ id: '1', metadata: { taskId: 'T1', stepId: 's1' }, createdAt: '2026-01-01T00:03:00.000Z' }),
      job({ id: '2', metadata: { taskId: 'T1', pipelineStepId: 's2' }, createdAt: '2026-01-01T00:02:00.000Z' }),
      job({ id: '3', metadata: { taskId: 'T2', stepId: 's1' }, createdAt: '2026-01-01T00:01:00.000Z' }),
      job({ id: '4', metadata: {}, createdAt: '2026-01-01T00:00:00.000Z' }),
      job({ id: '5', status: 'succeeded', metadata: { taskId: 'T1', stepId: 's1' } }),
    ]
    const { groups, totalJobs, truncated, hiddenTaskCount } = groupRunningJobs(jobs)
    expect(totalJobs).toBe(4)
    expect(truncated).toBe(false)
    expect(hiddenTaskCount).toBe(0)
    expect(groups.map((g) => g.taskId)).toEqual(['T1', 'T2', null])
    expect(groups[0].steps.map((s) => s.stepId)).toEqual(['s1', 's2'])
    expect(groups[0].jobCount).toBe(2)
    expect(groups[2].taskId).toBeNull()
    expect(groups[2].steps[0].stepId).toBeNull()
  })

  it('truncates task groups beyond LIST_TASK_CAP', () => {
    const jobs: JobLite[] = []
    for (let i = 0; i < LIST_TASK_CAP + 3; i++) {
      jobs.push(job({ id: `j${i}`, metadata: { taskId: `T${i}`, stepId: 's' } }))
    }
    const { groups, truncated, hiddenTaskCount, totalJobs } = groupRunningJobs(jobs)
    expect(totalJobs).toBe(LIST_TASK_CAP + 3)
    expect(truncated).toBe(true)
    expect(groups).toHaveLength(LIST_TASK_CAP)
    expect(hiddenTaskCount).toBe(3)
  })
})
