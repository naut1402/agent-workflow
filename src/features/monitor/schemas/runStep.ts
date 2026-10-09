import { z } from 'zod'
import { TaskIdSchema } from './taskCreate.js'

/**
 * Body for `POST /api/tasks/:id/run-step` — run the task's current step.
 * `targetStepId` chains gate-less steps up to that step; with
 * `skipIntermediate: true` the server jumps straight to it and runs only it.
 */
export const RunStepRequest = z.object({
  targetStepId: TaskIdSchema.nullish(),
  runnerId: z.string().min(1).nullish(),
  skipIntermediate: z.boolean().optional(),
})

export type RunStepRequest = z.infer<typeof RunStepRequest>
