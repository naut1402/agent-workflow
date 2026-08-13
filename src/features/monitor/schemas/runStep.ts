import { z } from 'zod'
import { TaskIdSchema } from './taskCreate.js'

/**
 * Body for `POST /api/tasks/:id/run-step` — dashboard-triggered execution of
 * the task's current step (`current_phase`). `targetStepId` is optional: when
 * set (and `skipIntermediate` is not true), the server keeps chaining to
 * subsequent gate-less steps (on each job success) until it reaches that step,
 * hits a HITL gate, or a job fails. With `skipIntermediate: true` + a
 * `targetStepId` ahead of the cursor, the server jumps `current_phase` to the
 * target and submits only that step's job (no chain).
 */
export const RunStepRequest = z.object({
  targetStepId: TaskIdSchema.nullish(),
  runnerId: z.string().min(1).nullish(),
  skipIntermediate: z.boolean().optional(),
})

export type RunStepRequest = z.infer<typeof RunStepRequest>
