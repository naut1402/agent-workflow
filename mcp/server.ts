#!/usr/bin/env bun
// MCP (Model Context Protocol) stdio server for the dev-team-dashboard project
// registry. Spawned by Claude Code via local MCP config (.claude/settings.local.json).
//
// It exposes CRUD over the SAME projects.json the REST/standalone server uses
// (via the shared backend/registry.ts) — so projects added from Claude Code and
// from the dashboard UI stay consistent. The MCP server operates directly on
// the registry file and does NOT require the HTTP server to be running.
//
// Đây là vai INBOUND (dashboard LÀM MCP server). Vai client — dashboard GỌI MCP
// server khác — nằm ở `src/features/mcp/`, không liên quan file này (D1/D2).
//
// Mode vận hành quyết định tool nào được đăng ký; mặc định `readonly` (D7).
// Xem `mcp/modes.ts`.
//
// Tools (design §4.2.6):
//   readonly + full
//     list_projects        {}                                  → { projects, defaultId }
//     get_project          { id }                               → { project }
//     get_knowledge_bundle { ids, project? }                    → { bundle }
//     list_tasks           { project?, status?, limit? }        → { tasks, total }
//     get_task_state       { taskId, project? }                 → { state }
//     list_artifacts       { taskId, project? }                 → { artifacts, subtasks }
//     read_artifact        { taskId, name, project? }           → { name, content, mtime }
//   full only
//     add_project          { path, name? }                      → { project }
//     remove_project       { id }                               → { removed: true }
//     create_qa            { taskId, questions, project? }      → { ok, path, created }
//
// Design ref: Tb4241005 design.md §4; T6f61d951 design.md §4.2 (create_qa).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { APP_VERSION } from '../src/backend/configs/appVersion.js'
import { emitEntity } from '../src/backend/events/index.js'
import { emitAudit, initLogDriverFromPrefs, installEventLogSubscriber } from '../src/backend/log/index.js'
import { list, get, add, remove } from '../src/backend/registry.js'
import { loadKnowledgeBundle } from '../src/features/knowledge/business/index.js'
import { fail, ok } from './envelope.js'
import { DEFAULT_MODE, isToolEnabled, resolveMode, type McpMode } from './modes.js'
import {
  addProjectInput,
  addProjectOutput,
  createQaInput,
  createQaOutput,
  getKnowledgeBundleInput,
  getProjectInput,
  getProjectOutput,
  getTaskStateInput,
  getTaskStateOutput,
  listArtifactsInput,
  listArtifactsOutput,
  listProjectsInput,
  listProjectsOutput,
  listTasksInput,
  listTasksOutput,
  readArtifactInput,
  removeProjectInput,
  removeProjectOutput,
} from './schemas.js'
import {
  handleCreateQa,
  handleGetTaskState,
  handleListArtifacts,
  handleListTasks,
  handleReadArtifact,
  rootOrFail,
} from './tools/tasks.js'

export { ok, fail, type McpErrorCode } from './envelope.js'
export { handleCreateQa, handleGetTaskState, handleListArtifacts, handleListTasks, handleReadArtifact } from './tools/tasks.js'

// ── Tool handlers (exported for unit testing) ──────────────────────────────────

export function handleListProjects(): any {
  return ok(list())
}

export function handleGetProject({ id }: { id: string }): any {
  const project = get(id)
  if (!project) return fail('not_found', `unknown project: ${id}`)
  return ok({ project })
}

export function handleAddProject({ path: inputPath, name }: { path: string; name?: string }): any {
  const result = add({ path: inputPath, name })
  // `in`-narrowing (boolean-discriminant narrowing misbehaves under vue-tsc).
  if ('error' in result) return fail('invalid_input', result.error)
  const id = result.project?.id ?? null
  // G9: KHÔNG gọi `MonitorController.addProject` — controller bám `Context` của
  // Hono, MCP không có request HTTP nào để dựng `Context`. Phát trực tiếp, với
  // ĐÚNG shape mà `src/features/monitor/controller.ts:141-148` đang phát, để
  // hai đường ghi không lệch dấu vết. Emit SAU khi persist thành công
  // (AGENTS.md §4); nhánh lỗi ở trên không phát gì.
  emitAudit({ op: 'create', entity: 'project', identifier: id, projectId: id })
  emitEntity('created', 'project', { id, projectId: id })
  return ok({ project: result.project })
}

export function handleRemoveProject({ id }: { id: string }): any {
  const result = remove(id)
  if ('error' in result) return fail('not_found', result.error)
  // Đối ứng `src/features/monitor/controller.ts:169-170` — xem ghi chú G9 ở trên.
  emitAudit({ op: 'delete', entity: 'project', identifier: id, projectId: id })
  emitEntity('deleted', 'project', { id, projectId: id })
  return ok({ removed: true as const })
}

/**
 * Đường vào knowledge cho agent không nói HTTP. Song song với
 * `GET /api/knowledge/bundle` — cùng gọi `loadKnowledgeBundle`, nên hai đường
 * không lệch nhau.
 */
export async function handleGetKnowledgeBundle({ ids, project }: { ids: string[]; project?: string }): Promise<any> {
  const gate = rootOrFail(project)
  if ('error' in gate) return gate.error
  // G8: bundle có trần 1 MiB — không phát `structuredContent` để khỏi nhân đôi
  // payload trên stdio. Tool này cũng không khai `outputSchema`.
  return ok({ bundle: await loadKnowledgeBundle(gate.root, ids) }, { structured: false })
}

// ── Server wiring ──────────────────────────────────────────────────────────────

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, openWorldHint: false } as const

export function createMcpServer(opts: { mode?: McpMode } = {}): McpServer {
  // Thuần: KHÔNG tự đọc env ở đây — `main()` quyết mode, test truyền thẳng.
  const mode = opts.mode ?? DEFAULT_MODE
  const server = new McpServer({ name: 'dev-team-dashboard', version: APP_VERSION })

  // A1: lọc ngay ở khâu đăng ký ⇒ tool ngoài allowlist không xuất hiện trong
  // `tools/list`, chứ không phải hiện ra rồi bị từ chối lúc gọi.
  const register = (name: string, config: any, cb: any) => {
    if (!isToolEnabled(mode, name)) return
    server.registerTool(name, config, cb)
  }

  register(
    'list_projects',
    {
      title: 'List projects',
      description: 'List all dev-team workspaces registered in the dashboard project registry.',
      inputSchema: listProjectsInput,
      outputSchema: listProjectsOutput,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => handleListProjects(),
  )

  register(
    'get_project',
    {
      title: 'Get project',
      description: 'Get one registered project by its id.',
      inputSchema: getProjectInput,
      outputSchema: getProjectOutput,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ id }: any) => handleGetProject({ id }),
  )

  register(
    'get_knowledge_bundle',
    {
      title: 'Get knowledge bundle',
      description:
        'Read knowledge entries by id (`<scope>/<slug>`, e.g. `global/coding-convention`). '
        + 'Resolves the ids listed in a task `knowledge_inputs`. Unknown ids come back as '
        + '{ id, error } instead of failing the whole call.',
      inputSchema: getKnowledgeBundleInput,
      // Cố ý không có `outputSchema` (G8) — payload tới 1 MiB.
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ ids, project }: any) => handleGetKnowledgeBundle({ ids, project }),
  )

  register(
    'list_tasks',
    {
      title: 'List tasks',
      description:
        'List tasks in a dev-team workspace with their current phase and pending HITL gate. '
        + 'Newest first; `total` counts matches before `limit` is applied.',
      inputSchema: listTasksInput,
      outputSchema: listTasksOutput,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ project, status, limit }: any) => handleListTasks({ project, status, limit }),
  )

  register(
    'get_task_state',
    {
      title: 'Get task state',
      description: 'Read the machine state file (`.dev-state/<taskId>.json`) of one task.',
      inputSchema: getTaskStateInput,
      outputSchema: getTaskStateOutput,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ taskId, project }: any) => handleGetTaskState({ taskId, project }),
  )

  register(
    'list_artifacts',
    {
      title: 'List task artifacts',
      description:
        'List a task\'s markdown artifacts (and known not-yet-created ones) plus its subtask dirs.',
      inputSchema: listArtifactsInput,
      outputSchema: listArtifactsOutput,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ taskId, project }: any) => handleListArtifacts({ taskId, project }),
  )

  register(
    'read_artifact',
    {
      title: 'Read task artifact',
      description:
        'Read one artifact file of a task (e.g. `design.md`). Names that escape the task '
        + 'directory are rejected.',
      inputSchema: readArtifactInput,
      // Cố ý không có `outputSchema` (G8) — artifact có thể lớn.
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ taskId, name, project }: any) => handleReadArtifact({ taskId, name, project }),
  )

  register(
    'add_project',
    {
      title: 'Add project',
      description:
        'Register a dev-team workspace. `path` must be an absolute path to a '
        + '`.dev-team-agent` directory (or a project root containing one). Idempotent.',
      inputSchema: addProjectInput,
      outputSchema: addProjectOutput,
      annotations: { idempotentHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ path: inputPath, name }: any) => handleAddProject({ path: inputPath, name }),
  )

  register(
    'remove_project',
    {
      title: 'Remove project',
      description:
        'Remove a project from the registry by id. Does NOT delete any files on disk. '
        + 'Removing the default project promotes the next remaining project (if any) to default.',
      inputSchema: removeProjectInput,
      outputSchema: removeProjectOutput,
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id }: any) => handleRemoveProject({ id }),
  )

  register(
    'create_qa',
    {
      title: 'Create QA questions',
      description:
        'Tạo hoặc bổ sung câu hỏi blocking vào `qa.md` của một task, theo khuôn chọn-đáp-án '
        + 'chuẩn mà QaPanel render được thành radio. Dùng thay vì tự viết `qa.md` bằng tay. '
        + 'Đánh số tiếp từ block Q lớn nhất đang có.',
      inputSchema: createQaInput,
      outputSchema: createQaOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ taskId, questions, project }: any) => handleCreateQa({ taskId, questions, project }),
  )

  return server
}

async function main() {
  // D10/G3: PHẢI ở trong main(), không top-level — đặt top-level thì
  // `import { createMcpServer }` trong test cũng đổi log driver toàn cục.
  initLogDriverFromPrefs()
  // D9/G2: event bus là in-process; tiến trình MCP không có subscriber nào.
  // Không gọi cái này thì `emitEntity` chạy vào chỗ không ai nghe và không vào
  // `events.jsonl`. Lưu ý giới hạn đã biết: event KHÔNG tới SSE của dashboard
  // (hai tiến trình khác nhau) — dashboard đang mở không tự refresh.
  installEventLogSubscriber()

  const mode = resolveMode()
  // `stderr`, không phải `stdout`: `stdout` là kênh JSON-RPC của stdio transport.
  process.stderr.write(`[dev-team-dashboard mcp] mode=${mode} version=${APP_VERSION}\n`)
  // F3/R3: 8 template ở `docs/template/agents/*.md` dạy agent "gọi MCP tool
  // `create_qa` rồi dừng", nhưng mặc định `readonly` không đăng ký tool đó và
  // KHÔNG chỗ nào trong `src/` đặt `DEVTEAM_MCP_MODE` — dashboard không tự bật
  // `full` khi spawn agent của chính nó. Agent không thấy tool thì ứng biến, tự
  // viết `qa.md` bằng tay, sai khuôn `## Q<n>` và `QaPanel` không render radio
  // được — một triệu chứng không trỏ về nguyên nhân. Log job bắt stderr của
  // tiến trình con nên dòng này rơi đúng chỗ người vận hành đang nhìn.
  //
  // Điều kiện bám `isToolEnabled` chứ không phải tên mode: thứ đang cảnh báo là
  // "tool không được đăng ký", không phải "mode tên là readonly".
  if (!isToolEnabled(mode, 'create_qa')) {
    process.stderr.write(
      `[dev-team-dashboard mcp] mode=${mode}: create_qa KHÔNG được đăng ký, `
      + 'nhưng docs/template/agents/* hướng dẫn agent gọi nó. '
      + 'Đặt DEVTEAM_MCP_MODE=full nếu chạy pipeline agent.\n',
    )
  }

  const transport = new StdioServerTransport()
  await createMcpServer({ mode }).connect(transport)
}

// Only start the stdio server when run directly (not when imported by tests).
if (import.meta.main) {
  main().catch((err) => {
    console.error(`[dev-team-dashboard mcp] fatal: ${err && err.stack ? err.stack : err}`)
    process.exit(1)
  })
}
