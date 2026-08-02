import { z } from 'zod'
import { TaskIdSchema } from './taskCreate.js'

/**
 * Body for `POST /api/tasks/:id/run-step` — dashboard-triggered execution of
 * the task's current step (`current_phase`). `targetStepId` is optional: when
 * set, the server keeps chaining to subsequent gate-less steps (on each job
 * success) until it reaches that step, hits a HITL gate, or a job fails.
 */
export const RunStepRequest = z.object({
  targetStepId: TaskIdSchema.nullish(),
  runnerId: z.string().min(1).nullish(),
})

export type RunStepRequest = z.infer<typeof RunStepRequest>
