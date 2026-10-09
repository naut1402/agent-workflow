import { z } from 'zod'

export const DocReviewRound = z
  .object({
    investigate: z.number().default(0),
    design: z.number().default(0),
  })
  .passthrough()

/**
 * Live per-task state at `.dev-state/<task-id>.json`; permissive so a
 * half-written file never crashes a request. Use `parseTaskState` for UI defaults.
 */
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
    archived: z.boolean().optional(),
    archived_at: z.string().nullable().optional(),
    /** Human-readable task title, written by the orchestrator or the create flow. */
    name: z.string().optional(),
    /**
     * Cờ cache của `pipeline.orchestrator.enabled`; nguồn chân lý là `pipeline.yaml`.
     * xem docs/architecture/code/monitor.md §5
     */
    orchestrator_enabled: z.boolean().optional(),
    /** Người bấm Stop / agent trả `halt` — trả quyền start về chế độ tay. */
    orchestrator_halted: z.boolean().optional(),
    orchestrator_halted_at: z.string().nullable().optional(),
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

/** Body for dashboard archive/unarchive of a completed task (`PUT /api/task-archive`). */
export const TaskArchivePatch = z.object({
  archived: z.boolean(),
  mtime: z.number(),
})

export type TaskArchivePatch = z.infer<typeof TaskArchivePatch>

/** Body for dashboard rename of a task (`PUT /api/task-name`). */
export const TaskNamePatch = z.object({
  name: z.string().trim().min(1).max(500),
  mtime: z.number(),
})

export type TaskNamePatch = z.infer<typeof TaskNamePatch>

/** Body cho nút Stop của node orchestrator (`PUT /api/task-orchestrator`). */
export const TaskOrchestratorPatch = z.object({
  halted: z.boolean(),
  mtime: z.number(),
})

export type TaskOrchestratorPatch = z.infer<typeof TaskOrchestratorPatch>

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
  archived: boolean
  archived_at: string | null
  name: string | null
  orchestrator_enabled: boolean
  orchestrator_halted: boolean
  orchestrator_halted_at: string | null
}

/**
 * Project an unknown raw value into a TaskStateView with safe defaults;
 * `hitl_pending` is not reconciled against the pipeline.
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
    archived: s.archived ?? false,
    archived_at: s.archived_at ?? null,
    name: typeof s.name === 'string' && s.name.trim() ? s.name.trim() : null,
    orchestrator_enabled: s.orchestrator_enabled ?? false,
    orchestrator_halted: s.orchestrator_halted ?? false,
    orchestrator_halted_at: s.orchestrator_halted_at ?? null,
  }
}
