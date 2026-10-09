import { z } from 'zod'

/**
 * Quick action in the dashboard-global catalog `artifact-actions.yaml`: maps
 * artifacts (by filename pattern) to an agent + prompt template submitted as a job.
 * xem docs/architecture/code/monitor.md §18
 */
export const ArtifactAction = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    artifact_patterns: z.array(z.string().min(1)).min(1),
    agent_ref: z.string().default(''),
    prompt_template: z.string().min(1),
    produces: z.array(z.string()).default([]),
    confirm: z.boolean().default(false),
    attach_points: z.array(z.string().min(1)).default(['artifact-title']),
    runner_id: z.string().min(1).optional(),
    require_approval: z.boolean().default(false),
  })
  .passthrough()

export type ArtifactAction = z.infer<typeof ArtifactAction>

/**
 * Nested menu tree for Monitor toolbars: groups have `children`, leaves point
 * at a catalog action via `action_id`.
 */
export type ArtifactMenuNode = {
  id: string
  label: string
  action_id?: string
  children?: ArtifactMenuNode[]
}

export const ArtifactMenuNodeSchema: z.ZodType<ArtifactMenuNode> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    action_id: z.string().min(1).optional(),
    children: z.array(ArtifactMenuNodeSchema).optional(),
  }),
) as z.ZodType<ArtifactMenuNode>

export const ArtifactActionsFile = z
  .object({
    version: z.number(),
    actions: z.array(ArtifactAction).default([]),
    menus: z.array(ArtifactMenuNodeSchema).default([]),
  })
  .passthrough()

export type ArtifactActionsFile = z.infer<typeof ArtifactActionsFile>

/** Body of `PUT /api/artifact-actions` — a full-catalog replace (CRUD save). */
export const PutArtifactActionsRequest = ArtifactActionsFile
export type PutArtifactActionsRequest = z.infer<typeof PutArtifactActionsRequest>

/** UI-facing projection of an action (no prompt template / patterns leaked). */
export const ArtifactActionView = ArtifactAction.pick({
  id: true,
  label: true,
  agent_ref: true,
  confirm: true,
  attach_points: true,
  runner_id: true,
  require_approval: true,
})
export type ArtifactActionView = z.infer<typeof ArtifactActionView>

export const MAX_SELECTION_CHARS = 50_000

/** Body of `POST /api/artifact-actions/run`, validated at the HTTP boundary. */
export const RunArtifactActionRequest = z.object({
  taskId: z.string().min(1),
  actionId: z.string().min(1),
  artifactName: z.string().min(1),
  runnerId: z.string().min(1).optional(),
  selectedText: z.string().max(MAX_SELECTION_CHARS).optional(),
  selectionStartLine: z.number().int().positive().optional(),
  selectionEndLine: z.number().int().positive().optional(),
})

export type RunArtifactActionRequest = z.infer<typeof RunArtifactActionRequest>
