import { z } from 'zod'

/**
 * Declarative "quick action" attached to artifacts in the monitor viewer.
 * Loaded from `.dev-team-agent/artifact-actions.yaml`; each action maps an
 * artifact (matched by filename pattern) to an agent + prompt template that the
 * dashboard submits as a job.
 *
 * The schema is permissive (`.passthrough()`) so a hand-edited YAML with extra
 * keys still parses, and defaults fill optional guard fields.
 */
export const ArtifactAction = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    artifact_patterns: z.array(z.string().min(1)).min(1),
    agent_ref: z.string().min(1),
    prompt_template: z.string().min(1),
    produces: z.array(z.string()).default([]),
    confirm: z.boolean().default(false),
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

/** UI-facing projection of an action (no prompt template / patterns leaked). */
export const ArtifactActionView = ArtifactAction.pick({
  id: true,
  label: true,
  agent_ref: true,
  confirm: true,
})
export type ArtifactActionView = z.infer<typeof ArtifactActionView>

/** Body of `POST /api/artifact-actions/run`, validated at the HTTP boundary. */
export const RunArtifactActionRequest = z.object({
  taskId: z.string().min(1),
  actionId: z.string().min(1),
  artifactName: z.string().min(1),
  runnerId: z.string().min(1).optional(),
})

export type RunArtifactActionRequest = z.infer<typeof RunArtifactActionRequest>
