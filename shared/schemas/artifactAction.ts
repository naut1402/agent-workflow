import { z } from 'zod'

/**
 * Declarative "quick action" attached to artifacts in the monitor viewer.
 * Loaded from the dashboard-global catalog
 * (`~/.dev-team-dashboard/artifact-actions.yaml`, override via
 * `DEV_TEAM_DASHBOARD_HOME`); each action maps an artifact (matched by filename
 * pattern) to an agent + prompt template that the dashboard submits as a job.
 * `attach_points` decides where in the UI the action surfaces (artifact title
 * toolbar and/or the text-selection toolbar); an action can be attached to more
 * than one point. Catalog is shared across projects (like runners).
 *
 * The schema is permissive (`.passthrough()`) so a hand-edited YAML with extra
 * keys still parses, and defaults fill optional guard fields. `attach_points`
 * uses a plain string array (not a Zod enum) so unknown values from hand-edited
 * YAML round-trip instead of failing validation; the UI only offers the two MVP
 * values (`artifact-title` / `artifact-selection`).
 */
export const ArtifactAction = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    artifact_patterns: z.array(z.string().min(1)).min(1),
    // Optional: empty means "run prompt_template as-is, no agent system prompt
    // merged in" (server/runners/agentResolver.ts treats a blank ref as an
    // ad-hoc agent). A non-empty ref must resolve to a real agent file with a
    // role compatible with what prompt_template asks for — see improve-doc's
    // history in server/artifactActions/default.ts for why binding a rigid
    // pipeline agent (e.g. doc-reviewer, which explicitly refuses to edit the
    // file it reviews) to a free-form "rewrite this doc" action breaks the job.
    agent_ref: z.string().default(''),
    prompt_template: z.string().min(1),
    produces: z.array(z.string()).default([]),
    confirm: z.boolean().default(false),
    attach_points: z.array(z.string().min(1)).default(['artifact-title']),
    runner_id: z.string().min(1).optional(),
    // When true, the job runs against a scratch copy of the task workspace
    // instead of the real files — the user reviews the proposed result (and
    // can send follow-up feedback into the same CLI session) before anything
    // is written to the real artifact. See server/runners/jobQueue.ts
    // `submitApprovalJob`/`approveJob`/`discardJob`/`sendJobFeedback`.
    require_approval: z.boolean().default(false),
  })
  .passthrough()

export type ArtifactAction = z.infer<typeof ArtifactAction>

/**
 * Nested menu tree for Monitor toolbars (title / selection). Groups have
 * `children`; leaves point at a catalog action via `action_id`.
 * YAML without `menus` stays valid — defaults to `[]` (flat toolbar buttons).
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
)

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

// Max characters accepted for a selection-derived quick action, so a wildly
// large selection can't balloon the job prompt / request payload.
export const MAX_SELECTION_CHARS = 50_000

/** Body of `POST /api/artifact-actions/run`, validated at the HTTP boundary. */
export const RunArtifactActionRequest = z.object({
  taskId: z.string().min(1),
  actionId: z.string().min(1),
  artifactName: z.string().min(1),
  runnerId: z.string().min(1).optional(),
  selectedText: z.string().max(MAX_SELECTION_CHARS).optional(),
  // 1-indexed line range of `selectedText` within the artifact's raw source,
  // best-effort computed client-side (ArtifactPanel maps the DOM selection
  // back to the containing markdown block's source — see
  // useArtifactSelectionToolbar.ts). Lets the runner locate the selection in
  // the file instead of only getting the bare (rendered-HTML) text, which
  // can't be reliably re-found by search when it spans formatted markdown.
  selectionStartLine: z.number().int().positive().optional(),
  selectionEndLine: z.number().int().positive().optional(),
})

export type RunArtifactActionRequest = z.infer<typeof RunArtifactActionRequest>
