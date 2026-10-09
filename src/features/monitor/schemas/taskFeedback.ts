import { z } from 'zod'

/**
 * Body for `POST /api/tasks/:id/feedback` — resume the CLI session of the
 * task's most recent finished (non-approval) job.
 */
export const TaskFeedbackRequest = z.object({
  feedback: z.string().min(1),
  /** Step the chat was opened from; targets that step's newest finished job. */
  stepId: z.string().min(1).max(200).nullish(),
  /**
   * While the target step's job is running: `'queue'` (default) waits for it,
   * `'immediate'` cancels it and resumes right away.
   */
  mode: z.enum(['queue', 'immediate']).optional(),
})

export type TaskFeedbackRequest = z.infer<typeof TaskFeedbackRequest>
