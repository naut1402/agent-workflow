import { z } from 'zod'

/**
 * Body for `POST /api/tasks/:id/feedback` — task-scoped chat resume: continue
 * the CLI session of the task's most recent finished (non-approval) job.
 * Separate from `POST /api/jobs/:id/feedback` (`sendJobFeedback`), which is
 * approval-flow only and keyed by `jobId`.
 */
export const TaskFeedbackRequest = z.object({
  feedback: z.string().min(1),
  /**
   * Pipeline step the chat was opened from. Targets that step's session (its
   * newest finished job) instead of whatever ran last — see
   * `sendTaskFeedback(..., { stepId })`.
   */
  stepId: z.string().min(1).max(200).nullish(),
  /**
   * How to handle feedback while the target step's job is still running —
   * `'queue'` (default) waits for it to finish; `'immediate'` cancels it and
   * resumes right away. Ignored when no job is currently running.
   */
  mode: z.enum(['queue', 'immediate']).optional(),
})

export type TaskFeedbackRequest = z.infer<typeof TaskFeedbackRequest>
