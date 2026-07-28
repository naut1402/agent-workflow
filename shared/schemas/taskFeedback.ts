import { z } from 'zod'

/**
 * Body for `POST /api/tasks/:id/feedback` — task-scoped chat resume: continue
 * the CLI session of the task's most recent finished (non-approval) job.
 * Separate from `POST /api/jobs/:id/feedback` (`sendJobFeedback`), which is
 * approval-flow only and keyed by `jobId`.
 */
export const TaskFeedbackRequest = z.object({
  feedback: z.string().min(1),
})

export type TaskFeedbackRequest = z.infer<typeof TaskFeedbackRequest>
