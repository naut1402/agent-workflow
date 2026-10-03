#!/usr/bin/env bun

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
  getTaskContextInput,
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
  handleGetTaskContext,
  handleGetTaskState,
  handleListArtifacts,
  handleListTasks,
  handleReadArtifact,
  rootOrFail,
} from './tools/tasks.js'

export { ok, fail, type McpErrorCode } from './envelope.js'
export {
  handleCreateQa,
  handleGetTaskContext,
  handleGetTaskState,
  handleListArtifacts,
  handleListTasks,
  handleReadArtifact,
} from './tools/tasks.js'

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
  if ('error' in result) return fail('invalid_input', result.error)
  const id = result.project?.id ?? null
  emitAudit({ op: 'create', entity: 'project', identifier: id, projectId: id })
  emitEntity('created', 'project', { id, projectId: id })
  return ok({ project: result.project })
}

export function handleRemoveProject({ id }: { id: string }): any {
  const result = remove(id)
  if ('error' in result) return fail('not_found', result.error)
  emitAudit({ op: 'delete', entity: 'project', identifier: id, projectId: id })
  emitEntity('deleted', 'project', { id, projectId: id })
  return ok({ removed: true as const })
}

export async function handleGetKnowledgeBundle({ ids, project }: { ids: string[]; project?: string }): Promise<any> {
  const gate = rootOrFail(project)
  if ('error' in gate) return gate.error
  return ok({ bundle: await loadKnowledgeBundle(gate.root, ids) }, { structured: false })
}

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, openWorldHint: false } as const

// xem docs/mcp/server.md §3.1
const TOOL_HINTS: { tools: string[]; hint: string }[] = [
  {
    tools: ['get_task_context'],
    hint: 'ĐỌC ĐẦU PHIÊN. Thay cho `cat request.md` + `cat pipeline.yaml` + `ls -la`.',
  },
  { tools: ['read_artifact', 'list_artifacts'], hint: 'đọc artifact của task theo tên, không cần biết cwd.' },
  { tools: ['get_task_state', 'list_tasks'], hint: 'trạng thái task.' },
  { tools: ['get_knowledge_bundle'], hint: 'resolve `knowledge_inputs`.' },
  {
    tools: ['create_qa'],
    hint: 'tạo câu hỏi blocking vào `qa.md` đúng khuôn chọn-đáp-án — không tự viết `qa.md` bằng tay.',
  },
]

export function buildServerInstructions(mode: McpMode): string {
  const lines = TOOL_HINTS.flatMap(({ tools, hint }) => {
    const enabled = tools.filter((t) => isToolEnabled(mode, t))
    return enabled.length ? [`- ${enabled.map((t) => `\`${t}\``).join(', ')} — ${hint}`] : []
  })

  const parts = [
    'Server state của dev-team-dashboard: task, artifact, knowledge của pipeline agent.',
    'Có tool tương đương thì gọi nó thay vì Bash: tool nhận `taskId` (và `project` tuỳ chọn) '
      + 'nên không phải `cd`, và kết quả là JSON có cấu trúc thay vì text phải tự parse.',
    lines.join('\n'),
  ]

  if (!isToolEnabled(mode, 'create_qa')) {
    parts.push(
      `\`create_qa\` KHÔNG có ở mode \`${mode}\`. Gặp câu hỏi blocking: ghi câu hỏi vào kết quả `
        + 'trả về và báo `BLOCKED`, không tự viết `qa.md`.',
    )
  }

  return parts.join('\n\n')
}

export function createMcpServer(opts: { mode?: McpMode } = {}): McpServer {
  const mode = opts.mode ?? DEFAULT_MODE
  const server = new McpServer(
    { name: 'dev-team-dashboard', version: APP_VERSION },
    { instructions: buildServerInstructions(mode) },
  )

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
    'get_task_context',
    {
      title: 'Get task context',
      description:
        'Read a task\'s whole context in ONE call: `request.md`, the pipeline config '
        + '(current step + next step), the artifact list with mtime/size, and the machine '
        + 'state. Use this instead of the `cd <task-dir> && cat request.md && cat '
        + 'pipeline.yaml && ls -la` chain at the start of a session. Takes a `taskId`, so '
        + 'there is no `cd` and no need to know the cwd. `include` narrows the sections; '
        + '`rules` (project-rules.md) is off by default because the orchestrator already '
        + 'injects it into the step prompt.',
      inputSchema: getTaskContextInput,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ taskId, project, include }: any) => handleGetTaskContext({ taskId, project, include }),
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
  // xem docs/mcp/server.md §8.4
  initLogDriverFromPrefs()
  installEventLogSubscriber()

  const mode = resolveMode()
  process.stderr.write(`[dev-team-dashboard mcp] mode=${mode} version=${APP_VERSION}\n`)
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

if (import.meta.main) {
  main().catch((err) => {
    console.error(`[dev-team-dashboard mcp] fatal: ${err && err.stack ? err.stack : err}`)
    process.exit(1)
  })
}
