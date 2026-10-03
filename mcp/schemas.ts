// Raw shape Zod cho `inputSchema` / `outputSchema` của tool MCP.
//
// `registerTool` nhận RAW SHAPE (object các field Zod), KHÔNG phải `z.object(...)`.
// Schema ở đây là schema I/O của giao thức MCP — không phải của feature nào —
// nên nằm ở `mcp/` chứ không phải `src/features/*/schemas/`.
//
// `outputSchema` chỉ khai cho tool payload nhỏ (C1/G8): `get_knowledge_bundle`
// và `read_artifact` cố ý KHÔNG có, vì `structuredContent` nhân đôi payload trên
// stdio và bundle có trần 1 MiB.

import { z } from 'zod'
import { MAX_BUNDLE_IDS } from '../src/features/knowledge/schemas/knowledge.js'

// ── Khối dùng chung ───────────────────────────────────────────────────────────

export const ProjectRef = z
  .string()
  .min(1)
  .describe('Project id (from list_projects); omit for the default project.')

/**
 * Lớp phòng thủ THỨ HAI cho path traversal (E3) — lớp thứ nhất là
 * `resolvePathUnder` / `resolveArtifact`. Cần cả hai: `resolvePathUnder(root,
 * 'tasks', '../.dev-state')` vẫn nằm trong root nên KHÔNG bị chặn ở lớp một,
 * còn `'..'` + `.json` lại thành một tên file vô hại.
 *
 * `(?!\.+$)` loại `.` và `..` (và mọi chuỗi toàn dấu chấm); lớp ký tự loại
 * `/`, `\`, `%` nên không dựng được separator dưới mọi dạng mã hoá.
 *
 * Phải nhận được mọi định dạng id đang dùng thật: `20260927_001` · `Tb4241005`
 * · `auto-0bdc9595` — chặn quá tay thì `list_tasks` trả ra id mà
 * `get_task_state` từ chối, hai tool tự mâu thuẫn.
 */
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

/**
 * `.passthrough()`: field THỪA ở registry không được làm đỏ runtime (E2).
 *
 * Field THIẾU thì `.passthrough()` không đỡ, mà `loadRegistry` không normalize
 * entry bao giờ — một `projects.json` sửa tay thiếu `kind` sẽ làm `list_projects`
 * ném `McpError -32602` lúc validate output. `list_projects` là tool discovery duy
 * nhất, nên một entry hỏng khoá agent ra khỏi TOÀN BỘ MCP trong khi REST vẫn phục
 * vụ đúng dữ liệu đó. Chỉ `id` / `name` / `path` là bắt buộc; phần còn lại
 * `.optional()` để MCP không kém chịu lỗi hơn REST.
 *
 * `add()` vẫn luôn set đủ field — đây là lưới an toàn cho file sửa tay, không
 * phải nới lỏng hợp đồng ghi.
 */
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

// ── Input shapes ──────────────────────────────────────────────────────────────

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
  // Trần đọc từ hằng của feature knowledge, không gõ số (gỡ L12).
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

/**
 * Sections `get_task_context` can return. Kept as an array so the enum, the type
 * and the handler's allowlist all come from one declaration.
 */
export const TASK_CONTEXT_SECTIONS = ['request', 'pipeline', 'artifacts', 'state', 'rules'] as const
export type TaskContextSection = (typeof TASK_CONTEXT_SECTIONS)[number]

/** Sections returned when `include` is omitted — `rules` is NOT one of them. */
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

// Shape của tool ghi `create_qa` (mode `full`). `TaskId` chứ không phải
// `z.string()`: đây là lớp phòng thủ path traversal thứ hai, đồng nhất với 4
// tool task còn lại.
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

// ── Output shapes (chỉ cho tool payload nhỏ — C1/G8) ──────────────────────────

// Object ở gốc, KHÔNG phải mảng trần: SDK chạy `normalizeObjectSchema` trên
// `outputSchema`, mảng ở gốc là hỏng ngay lúc đăng ký.
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
