import { z } from 'zod'
import { MAX_BUNDLE_IDS } from '../src/features/knowledge/schemas/knowledge.js'

export const ProjectRef = z
  .string()
  .min(1)
  .describe('Project id (from list_projects); omit for the default project.')

// xem docs/mcp/server.md §4.5, §8.2
export const TASK_ID_PATTERN = /^(?!\.+$)[A-Za-z0-9._-]+$/
export const TASK_ID_MAX = 200

export function isSafeTaskId(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length < 1 || value.length > TASK_ID_MAX) return false
  return TASK_ID_PATTERN.test(value)
}

export const TaskId = z
  .string()
  .min(1)
  .max(TASK_ID_MAX)
  .regex(TASK_ID_PATTERN, 'invalid task id')
  .describe('Task id (from list_tasks), e.g. `20260927_001`.')

// xem docs/mcp/server.md §4.1
export const ProjectOut = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.string().optional(),
    path: z.string(),
    addedAt: z.string().optional(),
    default: z.boolean().optional(),
  })
  .passthrough()

export const listProjectsInput = {}

export const getProjectInput = {
  id: z.string().min(1).describe('Project id (from list_projects).'),
}

export const addProjectInput = {
  path: z.string().min(1).describe('Absolute path to a .dev-team-agent dir or its project root.'),
  name: z.string().optional().describe('Optional display name (defaults to the project folder name).'),
}

export const removeProjectInput = {
  id: z.string().min(1).describe('Project id to remove.'),
}

export const getKnowledgeBundleInput = {
  ids: z.array(z.string()).max(MAX_BUNDLE_IDS).describe('Entry ids to read.'),
  project: ProjectRef.optional(),
}

export const listTasksInput = {
  project: ProjectRef.optional(),
  status: z
    .enum(['running', 'waiting', 'completed'])
    .optional()
    .describe('Filter by derived status: `waiting` = a HITL gate is pending.'),
  limit: z.number().int().min(1).max(200).optional().describe('Default 50.'),
}

export const getTaskStateInput = { taskId: TaskId, project: ProjectRef.optional() }

export const listArtifactsInput = { taskId: TaskId, project: ProjectRef.optional() }

export const TASK_CONTEXT_SECTIONS = ['request', 'pipeline', 'artifacts', 'state', 'rules'] as const
export type TaskContextSection = (typeof TASK_CONTEXT_SECTIONS)[number]

export const DEFAULT_TASK_CONTEXT_SECTIONS: readonly TaskContextSection[] = [
  'request',
  'pipeline',
  'artifacts',
  'state',
]

export const getTaskContextInput = {
  taskId: TaskId,
  project: ProjectRef.optional(),
  include: z
    .array(z.enum(TASK_CONTEXT_SECTIONS))
    .optional()
    .describe("Defaults to ['request','pipeline','artifacts','state'] — 'rules' is opt-in."),
}

export const readArtifactInput = {
  taskId: TaskId,
  name: z.string().min(1).describe('Artifact file name, e.g. `design.md`.'),
  project: ProjectRef.optional(),
}

export const createQaInput = {
  taskId: TaskId,
  questions: z
    .array(
      z.object({
        prompt: z.string().min(1).describe('Nội dung câu hỏi.'),
        choices: z.array(z.string().min(1)).min(2).max(10).describe('Danh sách đáp án (≥2).'),
      }),
    )
    .min(1)
    .max(20)
    .describe('Danh sách câu hỏi blocking cần người trả lời.'),
  project: ProjectRef.optional(),
}

export const listProjectsOutput = {
  projects: z.array(ProjectOut),
  defaultId: z.string().nullable(),
}

export const getProjectOutput = { project: ProjectOut }
export const addProjectOutput = { project: ProjectOut }
export const removeProjectOutput = { removed: z.literal(true) }

export const listTasksOutput = {
  tasks: z.array(
    z.object({
      id: z.string(),
      name: z.string().nullable(),
      phase: z.string().nullable(),
      hitlPending: z.string().nullable(),
      updatedAt: z.number().nullable(),
    }),
  ),
  total: z.number().int(),
}

export const getTaskStateOutput = { state: z.record(z.unknown()) }

export const listArtifactsOutput = {
  artifacts: z.record(
    z.object({ exists: z.boolean(), mtime: z.number().nullable(), size: z.number() }),
  ),
  subtasks: z.array(z.string()),
}

export const createQaOutput = {
  ok: z.literal(true),
  path: z.string(),
  created: z.number().int(),
}
