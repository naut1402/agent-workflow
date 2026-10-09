import { z } from 'zod'
import { TaskIdSchema } from './taskCreate.js'

/** Phạm vi lùi con trỏ pipeline — step nào bị coi là chưa chạy. */
export const ResetScope = z.enum(['step', 'onward'])
/** Phạm vi xoá artifact — độc lập với `ResetScope`, `none` là không xoá gì. */
export const DeleteScope = z.enum(['none', 'step', 'onward'])

/**
 * Body for `POST /api/tasks/:id/reset-step` — rolls `current_phase` back to
 * `stepId`; `resetScope` picks the steps counted as un-run, `deleteScope`
 * picks whose artifacts get deleted.
 */
export const ResetStepRequest = z
  .object({
    stepId: TaskIdSchema,
    resetScope: ResetScope,
    deleteScope: DeleteScope,
  })
  .refine((v) => !(v.deleteScope === 'onward' && v.resetScope === 'step'), {
    message: 'deleteScope "onward" requires resetScope "onward"',
    path: ['deleteScope'],
  })

export type ResetStepRequest = z.infer<typeof ResetStepRequest>
