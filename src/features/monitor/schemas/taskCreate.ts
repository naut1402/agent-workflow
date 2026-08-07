import { z } from 'zod'

/**
 * Body for creating a task from the dashboard (`POST /api/tasks`).
 * Zod is the single source of truth — server types come from `z.infer`.
 */

/**
 * Task id charset. Stricter than the `/[^\w\-]/` guard the read/update routes
 * use: a created id must also start alphanumeric and stay within 64 chars, so
 * no separator, dot or leading dash can ever reach `path.join`.
 */
export const TASK_ID_PATTERN = /^[A-Za-z0-9][\w-]{0,63}$/

export const TaskIdSchema = z.string().regex(TASK_ID_PATTERN, 'invalid task id')

export const TASK_SOURCES = ['prompt', 'issue'] as const
export type TaskSource = (typeof TASK_SOURCES)[number]

/** Pipeline payload written to `tasks/<id>/pipeline.yaml`; only `steps` is required. */
export const CreateTaskPipeline = z
  .object({
    steps: z.array(z.record(z.unknown())).min(1),
  })
  .passthrough()

export type CreateTaskPipeline = z.infer<typeof CreateTaskPipeline>

export const CreateTaskRequest = z.object({
  /** Optional — server mints a random id when omitted (NL chat without taskId). */
  taskId: TaskIdSchema.optional(),
  source: z.enum(TASK_SOURCES).default('prompt'),
  /** Body of `request.md` — the brief handed to the first pipeline step. */
  prompt: z.string().min(1).max(200_000),
  issueUrl: z.string().url().nullish(),
  parentTaskId: TaskIdSchema.nullish(),
  /** Named pipeline profile; resolved server-side from `pipeline-profiles/`. */
  profileName: z.string().min(1).nullish(),
  /** Inline pipeline content — takes precedence over `profileName` when both are sent. */
  pipeline: CreateTaskPipeline.nullish(),
  /** Knowledge entry ids (`<scope>/<slug>`) injected into the first step. */
  knowledgeInputs: z.array(z.string().min(1)).max(50).default([]),
  autoReview: z.boolean().default(false),
  exportJson: z.boolean().default(false),
  /** Submit the first step to a runner right after scaffolding. */
  run: z.boolean().default(false),
  runnerId: z.string().min(1).nullish(),
})

export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>

/** Body for `POST /api/github/issue` (preview an issue before creating a task). */
export const GithubIssueRequest = z.object({
  url: z.string().min(1),
})

export type GithubIssueRequest = z.infer<typeof GithubIssueRequest>
