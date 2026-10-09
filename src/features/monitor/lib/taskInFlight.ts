import { fetchJobs } from '../../runner/scripts/runnerApi'

/**
 * Status job còn sống mà `GET /api/jobs?status=` chấp nhận.
 * xem docs/architecture/code/monitor.md §21
 */
export const IN_FLIGHT_JOB_STATUSES = ['running', 'queued'] as const

function normalizeProjectId(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

/**
 * Job này có thuộc task đang xét không; `projectId` chỉ loại khi cả hai phía có giá trị và khác nhau.
 * xem docs/architecture/code/monitor.md §21
 */
export function jobBelongsToTask(job: any, taskId: string, projectId?: string | null): boolean {
  if (!job || job.metadata?.taskId !== taskId) return false
  const jobProject = normalizeProjectId(job.metadata?.projectId)
  const uiProject = normalizeProjectId(projectId)
  return !(jobProject && uiProject && jobProject !== uiProject)
}

/** true nếu task còn job queued/running; lỗi mạng/parse trả false (best-effort). */
export async function hasInFlightJob(taskId: string, projectId?: string | null): Promise<boolean> {
  if (!taskId) return false
  const settled = await Promise.allSettled(
    IN_FLIGHT_JOB_STATUSES.map((status) => fetchJobs({ status })),
  )
  return settled.some(
    (r) =>
      r.status === 'fulfilled' &&
      Array.isArray(r.value?.jobs) &&
      r.value.jobs.some((j: any) => jobBelongsToTask(j, taskId, projectId)),
  )
}
