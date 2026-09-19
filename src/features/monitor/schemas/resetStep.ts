import { z } from 'zod'
import { TaskIdSchema } from './taskCreate.js'

/** Phạm vi lùi con trỏ pipeline — step nào bị coi là chưa chạy. */
export const ResetScope = z.enum(['step', 'onward'])
/** Phạm vi xoá artifact — độc lập với `ResetScope`, `none` là không xoá gì. */
export const DeleteScope = z.enum(['none', 'step', 'onward'])

/**
 * Body for `POST /api/tasks/:id/reset-step` — rolls `current_phase` back to
 * `stepId`. Two independent axes: `resetScope` decides which steps count as
 * un-run (`onward` = `stepId` and everything after it), `deleteScope` decides
 * whose artifacts get deleted (`none` = keep every file).
 */
export const ResetStepRequest = z
  .object({
    stepId: TaskIdSchema,
    resetScope: ResetScope,
    deleteScope: DeleteScope,
  })
  // Xoá artifact của step mà con trỏ vẫn coi là đã chạy xong là state rách:
  // file biến mất nhưng pipeline không cho chạy lại step đó.
  .refine((v) => !(v.deleteScope === 'onward' && v.resetScope === 'step'), {
    message: 'deleteScope "onward" requires resetScope "onward"',
    path: ['deleteScope'],
  })

export type ResetStepRequest = z.infer<typeof ResetStepRequest>
