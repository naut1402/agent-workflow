import { z } from 'zod'
import { TaskIdSchema } from './taskCreate.js'

/**
 * Body for `POST /api/tasks/:id/reset-step` — rolls `current_phase` back to
 * `stepId` and deletes its artifacts. `cascade: true` also deletes artifacts
 * for every step after `stepId`; `cascade: false` deletes only `stepId`'s own
 * artifacts.
 */
export const ResetStepRequest = z.object({
  stepId: TaskIdSchema,
  cascade: z.boolean(),
})

export type ResetStepRequest = z.infer<typeof ResetStepRequest>
