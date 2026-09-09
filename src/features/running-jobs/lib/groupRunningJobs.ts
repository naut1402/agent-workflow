import { stepIdOf } from './stepIdOf'

export const UNKNOWN_TASK_KEY = '__unknown__'
export const LIST_TASK_CAP = 20

export type JobLite = {
  id: string
  status: string
  metadata?: Record<string, unknown>
  createdAt?: string
}

export type StepGroup = { stepId: string | null; jobs: JobLite[] }
export type TaskGroup = { taskId: string | null; steps: StepGroup[]; jobCount: number }

export function groupRunningJobs(jobs: JobLite[]): {
  groups: TaskGroup[]
  totalJobs: number
  truncated: boolean
  hiddenTaskCount: number
} {
  const running = jobs.filter((j) => j.status === 'running')
  const totalJobs = running.length

  type Acc = Map<string, { taskId: string | null; stepOrder: string[]; steps: Map<string, StepGroup> }>
  const byTask: Acc = new Map()
  const taskOrder: string[] = []

  for (const job of running) {
    const rawTask = job.metadata?.taskId
    const taskKey =
      typeof rawTask === 'string' && rawTask ? rawTask : UNKNOWN_TASK_KEY
    const taskId = taskKey === UNKNOWN_TASK_KEY ? null : taskKey

    let bucket = byTask.get(taskKey)
    if (!bucket) {
      bucket = { taskId, stepOrder: [], steps: new Map() }
      byTask.set(taskKey, bucket)
      taskOrder.push(taskKey)
    }

    const stepId = stepIdOf(job) ?? null
    const stepKey = stepId ?? '__null__'
    let step = bucket.steps.get(stepKey)
    if (!step) {
      step = { stepId, jobs: [] }
      bucket.steps.set(stepKey, step)
      bucket.stepOrder.push(stepKey)
    }
    step.jobs.push(job)
  }

  // Known tasks in first-seen order; unknown bucket last.
  const orderedKeys = [
    ...taskOrder.filter((k) => k !== UNKNOWN_TASK_KEY),
    ...(byTask.has(UNKNOWN_TASK_KEY) ? [UNKNOWN_TASK_KEY] : []),
  ]

  const allGroups: TaskGroup[] = orderedKeys.map((key) => {
    const bucket = byTask.get(key)!
    const steps = bucket.stepOrder.map((sk) => bucket.steps.get(sk)!)
    const jobCount = steps.reduce((n, s) => n + s.jobs.length, 0)
    return { taskId: bucket.taskId, steps, jobCount }
  })

  const truncated = allGroups.length > LIST_TASK_CAP
  return {
    groups: allGroups.slice(0, LIST_TASK_CAP),
    totalJobs,
    truncated,
    hiddenTaskCount: truncated ? allGroups.length - LIST_TASK_CAP : 0,
  }
}
