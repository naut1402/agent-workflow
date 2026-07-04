import { z } from 'zod'

/**
 * Live per-task state, persisted by the orchestrator at
 * `.dev-state/<task-id>.json`. The dashboard only reads it.
 *
 * The schema is intentionally permissive (`.passthrough()`, all fields optional)
 * to honour the defensive rule that a half-written state file must never crash a
 * request. Use `parseTaskState` to obtain a record with safe UI defaults applied.
 */
export const DocReviewRound = z
  .object({
    investigate: z.number().default(0),
    design: z.number().default(0),
  })
  .passthrough()

export const TaskState = z
  .object({
    parent_task_id: z.string().nullable().optional(),
    current_phase: z.string().nullable().optional(),
    hitl_pending: z.union([z.string(), z.boolean()]).nullable().optional(),
    review_round: z.number().optional(),
    auto_review: z.boolean().optional(),
    doc_review_round: DocReviewRound.optional(),
    inherit_from_parent: z.array(z.string()).optional(),
    export_json: z.boolean().optional(),
  })
  .passthrough()

export type TaskState = z.infer<typeof TaskState>

/** Body for dashboard HITL approve/reject (`PUT /api/task-state`). */
export const TaskStatePatch = z.object({
  action: z.enum(['approve', 'reject']),
  gate_id: z.string().min(1),
  feedback: z.string().optional(),
  mtime: z.number(),
})

export type TaskStatePatch = z.infer<typeof TaskStatePatch>

/** UI-facing projection of task state with the same safe defaults the API applies. */
export interface TaskStateView {
  parent_task_id: string | null
  current_phase: string | null
  hitl_pending: string | boolean | null
  review_round: number
  auto_review: boolean
  doc_review_round: { investigate: number; design: number } & Record<string, unknown>
  inherit_from_parent: string[]
  export_json: boolean
}

/**
 * Project an unknown raw value into a TaskStateView with safe defaults.
 * Mirrors the field defaulting in the `/api/tasks` handler so the two never drift.
 */
export function parseTaskState(raw: unknown): TaskStateView {
  const parsed = TaskState.safeParse(raw)
  const s: TaskState = parsed.success ? parsed.data : {}
  return {
    parent_task_id: s.parent_task_id ?? null,
    current_phase: s.current_phase ?? null,
    hitl_pending: s.hitl_pending ?? null,
    review_round: s.review_round ?? 0,
    auto_review: s.auto_review ?? false,
    doc_review_round: { investigate: 0, design: 0, ...(s.doc_review_round ?? {}) },
    inherit_from_parent: s.inherit_from_parent ?? [],
    export_json: s.export_json ?? false,
  }
}
