import { z } from 'zod'

/**
 * Declarative "quick action" attached to artifacts in the monitor viewer.
 * Loaded from `.dev-team-agent/artifact-actions.yaml`; each action maps an
 * artifact (matched by filename pattern) to an agent + prompt template that the
 * dashboard submits as a job. `attach_points` decides where in the UI the
 * action surfaces (artifact title toolbar and/or the text-selection toolbar);
 * an action can be attached to more than one point.
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
  })
  .passthrough()

export type ArtifactAction = z.infer<typeof ArtifactAction>

export const ArtifactActionsFile = z
  .object({
    version: z.number(),
    actions: z.array(ArtifactAction).default([]),
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
})

export type RunArtifactActionRequest = z.infer<typeof RunArtifactActionRequest>
