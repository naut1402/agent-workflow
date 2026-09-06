import { fetchJobs } from '../../runner/scripts/runnerApi'

/**
 * Status mà `GET /api/jobs?status=` chấp nhận VÀ nghĩa là job còn sống.
 * Cố tình KHÔNG có `awaiting_recovery`: `listOrGetJobs` (`features/runner/controller.ts`)
 * có allow-list riêng thiếu status đó nên query sẽ trả 400 — biết hạn chế này và
 * chấp nhận false-negative thay vì làm hỏng cả lời gọi còn lại.
 * `awaiting_approval` bị loại vì job đã dừng, chỉ chờ người duyệt proposal.
 */
export const IN_FLIGHT_JOB_STATUSES = ['running', 'queued'] as const

function normalizeProjectId(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

/**
 * Job này có thuộc task đang xét không?
 * `projectId` chỉ dùng để LOẠI khi cả hai phía đều có giá trị và khác nhau —
 * job submit ở project mặc định ghi `metadata.projectId: undefined`
 * (`monitor/controller.ts`: `projectId: this.projectId || undefined`), so sánh
 * chặt sẽ bỏ sót đúng nhóm job của project mặc định.
 */
export function jobBelongsToTask(job: any, taskId: string, projectId?: string | null): boolean {
  if (!job || job.metadata?.taskId !== taskId) return false
  const jobProject = normalizeProjectId(job.metadata?.projectId)
  const uiProject = normalizeProjectId(projectId)
  return !(jobProject && uiProject && jobProject !== uiProject)
}

/**
 * true nếu task còn job queued/running. Best-effort: mọi lỗi mạng/parse đều trả
 * false để KHÔNG chặn xoá — nút xoá vẫn phải là lối thoát khi backend lỗi.
 * `allSettled` (không phải `all`): một status lỗi vẫn để status còn lại cảnh báo được.
 */
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
