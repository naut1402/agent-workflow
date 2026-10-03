// xem docs/mcp/server.md §8.1, §8.2
import { z } from 'zod'
import { readTextFile, realpathSync, resolvePathUnder, statSafe } from '../../src/backend/lib/fileHelper.js'
import { knownArtifactsFor, loadPipelineConfig } from '../../src/features/monitor/business/peers.js'
import { createQa } from '../../src/features/monitor/business/tasks/qa.js'
import {
  collectTasks,
  listArtifacts,
  readState,
  resolveArtifact,
} from '../../src/features/monitor/business/tasks/reads.js'
import { AbstractMcpTools, ProjectRef, READ_ONLY_ANNOTATIONS, type ToolDef } from '../AbstractMcpTools.js'

// xem docs/mcp/server.md §4.5, §8.2
const TASK_ID_PATTERN =/^(?!\.+$)[A-Za-z0-9._-]+$/
const TASK_ID_MAX = 200

const TaskId = z
  .string()
  .min(1)
  .max(TASK_ID_MAX)
  .regex(TASK_ID_PATTERN, 'invalid task id')
  .describe('Task id (from list_tasks), e.g. `20260927_001`.')

const TASK_CONTEXT_SECTIONS = ['request', 'pipeline', 'artifacts', 'state', 'rules'] as const
type TaskContextSection = (typeof TASK_CONTEXT_SECTIONS)[number]
const DEFAULT_TASK_CONTEXT_SECTIONS: readonly TaskContextSection[] = ['request', 'pipeline', 'artifacts', 'state']
const TASK_CONTEXT_MAX_CHARS = 64 * 1024
const DEFAULT_TASK_LIMIT = 50

type TaskStatus = 'running' | 'waiting' | 'completed'

type TaskContextParts = {
  state: any
  artifacts: any
  request: any
  pipelineCfg: any
  rules: string | null
}

function isSafeTaskId(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length < 1 || value.length > TASK_ID_MAX) return false
  return TASK_ID_PATTERN.test(value)
}

function statusOf(hitlPending: string | null, phase: string | null): TaskStatus {
  if (hitlPending !== null) return 'waiting'
  if (phase === 'completed') return 'completed'
  return 'running'
}

function payloadOf(result: any): any {
  if (!result || result.isError) return null
  if (result.structuredContent) return result.structuredContent
  const text = result.content?.[0]?.text
  if (typeof text !== 'string') return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function capped(content: string): { content: string; truncated: boolean } {
  if (content.length <= TASK_CONTEXT_MAX_CHARS) return { content, truncated: false }
  return { content: content.slice(0, TASK_CONTEXT_MAX_CHARS), truncated: true }
}

function summarisePipeline(cfg: any, state: any): any {
  const steps = Array.isArray(cfg?.steps) ? cfg.steps : []
  const slim = steps.map((s: any) => ({
    id: s?.id ?? null,
    name: s?.name ?? null,
    agent: s?.agent ?? null,
    produces: Array.isArray(s?.produces) ? s.produces : [],
  }))
  const currentStepId =
    state && typeof state.current_phase === 'string' && state.current_phase
      ? state.current_phase
      : null
  const idx = currentStepId ? slim.findIndex((s: any) => s.id === currentStepId) : -1
  const nextStepId = idx >= 0 && idx + 1 < slim.length ? slim[idx + 1].id : null
  return { steps: slim, currentStepId, nextStepId }
}

function fileSection(name: string, content: unknown, extra?: Record<string, unknown>): any {
  return typeof content === 'string' ? { name, ...extra, ...capped(content) } : null
}

function taskSummary(taskId: string, stateObj: any): any {
  if (!stateObj) return null
  return {
    id: taskId,
    name: stateObj.name ?? null,
    phase: stateObj.current_phase ?? null,
    hitlPending: stateObj.hitl_pending ?? null,
  }
}

function buildContextPayload(
  taskId: string,
  parts: TaskContextParts,
  wants: (section: string) => boolean,
): any {
  const { state, artifacts, request, pipelineCfg, rules } = parts
  const stateObj = state?.state ?? null
  const pipeline =
    pipelineCfg && !pipelineCfg.untrusted ? summarisePipeline(pipelineCfg, stateObj) : null

  return {
    taskId,
    task: taskSummary(taskId, stateObj),
    request: fileSection('request.md', request?.content, { mtime: request?.mtime ?? null }),
    pipeline,
    artifacts: artifacts?.artifacts ?? null,
    subtasks: artifacts?.subtasks ?? null,
    state: wants('state') ? stateObj : null,
    rules: fileSection('project-rules.md', rules),
  }
}

export class TaskTools extends AbstractMcpTools {
  definitions(): ToolDef[] {
    return [
      {
        name: 'get_task_context',
        access: 'read',
        hint: 'ĐỌC ĐẦU PHIÊN. Thay cho `cat request.md` + `cat pipeline.yaml` + `ls -la`.',
        config: {
          title: 'Get task context',
          description:
            'Read a task\'s whole context in ONE call: `request.md`, the pipeline config '
            + '(current step + next step), the artifact list with mtime/size, and the machine '
            + 'state. Use this instead of the `cd <task-dir> && cat request.md && cat '
            + 'pipeline.yaml && ls -la` chain at the start of a session. Takes a `taskId`, so '
            + 'there is no `cd` and no need to know the cwd. `include` narrows the sections; '
            + '`rules` (project-rules.md) is off by default because the orchestrator already '
            + 'injects it into the step prompt.',
          inputSchema: {
            taskId: TaskId,
            project: ProjectRef.optional(),
            include: z
              .array(z.enum(TASK_CONTEXT_SECTIONS))
              .optional()
              .describe("Defaults to ['request','pipeline','artifacts','state'] — 'rules' is opt-in."),
          },
          annotations: READ_ONLY_ANNOTATIONS,
        },
        handler: (args) => this.getTaskContext(args),
      },
      {
        name: 'read_artifact',
        access: 'read',
        hint: 'đọc một artifact của task theo tên, không cần biết cwd.',
        config: {
          title: 'Read task artifact',
          description:
            'Read one artifact file of a task (e.g. `design.md`). Names that escape the task '
            + 'directory are rejected.',
          inputSchema: {
            taskId: TaskId,
            name: z.string().min(1).describe('Artifact file name, e.g. `design.md`.'),
            project: ProjectRef.optional(),
          },
          annotations: READ_ONLY_ANNOTATIONS,
        },
        handler: (args) => this.readArtifact(args),
      },
      {
        name: 'list_artifacts',
        access: 'read',
        hint: 'liệt kê artifact của task.',
        config: {
          title: 'List task artifacts',
          description:
            'List a task\'s markdown artifacts (and known not-yet-created ones) plus its subtask dirs.',
          inputSchema: { taskId: TaskId, project: ProjectRef.optional() },
          outputSchema: {
            artifacts: z.record(
              z.object({ exists: z.boolean(), mtime: z.number().nullable(), size: z.number() }),
            ),
            subtasks: z.array(z.string()),
          },
          annotations: READ_ONLY_ANNOTATIONS,
        },
        handler: (args) => this.listArtifacts(args),
      },
      {
        name: 'get_task_state',
        access: 'read',
        hint: 'machine state của task.',
        config: {
          title: 'Get task state',
          description: 'Read the machine state file (`.dev-state/<taskId>.json`) of one task.',
          inputSchema: { taskId: TaskId, project: ProjectRef.optional() },
          outputSchema: { state: z.record(z.unknown()) },
          annotations: READ_ONLY_ANNOTATIONS,
        },
        handler: (args) => this.getTaskState(args),
      },
      {
        name: 'list_tasks',
        access: 'read',
        hint: 'danh sách task kèm phase và HITL gate đang chờ.',
        config: {
          title: 'List tasks',
          description:
            'List tasks in a dev-team workspace with their current phase and pending HITL gate. '
            + 'Newest first; `total` counts matches before `limit` is applied.',
          inputSchema: {
            project: ProjectRef.optional(),
            status: z
              .enum(['running', 'waiting', 'completed'])
              .optional()
              .describe('Filter by derived status: `waiting` = a HITL gate is pending.'),
            limit: z.number().int().min(1).max(200).optional().describe('Default 50.'),
          },
          outputSchema: {
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
          },
          annotations: READ_ONLY_ANNOTATIONS,
        },
        handler: (args) => this.listTasks(args),
      },
      {
        name: 'create_qa',
        access: 'write',
        hint: 'tạo câu hỏi blocking vào `qa.md` đúng khuôn chọn-đáp-án — không tự viết `qa.md` bằng tay.',
        unavailableHint:
          'Gặp câu hỏi blocking: ghi câu hỏi vào kết quả trả về và báo `BLOCKED`, không tự viết `qa.md`.',
        config: {
          title: 'Create QA questions',
          description:
            'Tạo hoặc bổ sung câu hỏi blocking vào `qa.md` của một task, theo khuôn chọn-đáp-án '
            + 'chuẩn mà QaPanel render được thành radio. Dùng thay vì tự viết `qa.md` bằng tay. '
            + 'Đánh số tiếp từ block Q lớn nhất đang có.',
          inputSchema: {
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
          },
          outputSchema: { ok: z.literal(true), path: z.string(), created: z.number().int() },
          annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        },
        handler: (args) => this.createQa(args),
      },
    ]
  }

  async listTasks({
    project,
    status,
    limit,
  }: { project?: string; status?: TaskStatus; limit?: number } = {}): Promise<any> {
    const gate = this.requireRoot(project)
    if ('error' in gate) return gate.error

    const rows = (await collectTasks(gate.root)).map((t: any) => ({
      id: t.task_id,
      name: t.name ?? null,
      phase: t.current_phase ?? null,
      hitlPending: t.hitl_pending ?? null,
      updatedAt: t.state_mtime ?? null,
    }))

    const filtered = status ? rows.filter((t) => statusOf(t.hitlPending, t.phase) === status) : rows
    const total = filtered.length

    const sorted = [...filtered].sort((a, b) => {
      if (a.updatedAt === b.updatedAt) return 0
      if (a.updatedAt === null) return 1
      if (b.updatedAt === null) return -1
      return b.updatedAt - a.updatedAt
    })

    return this.ok({ tasks: sorted.slice(0, limit ?? DEFAULT_TASK_LIMIT), total })
  }

  async getTaskState({ taskId, project }: { taskId: string; project?: string }): Promise<any> {
    const bad = this.badTaskId(taskId)
    if (bad) return bad
    const gate = this.requireRoot(project)
    if ('error' in gate) return gate.error

    const stateFile = resolvePathUnder(gate.root, '.dev-state', `${taskId}.json`)
    if (!stateFile) return this.fail('invalid_input', 'state path escapes the project root')

    const result = await readState(stateFile)
    if ('error' in result) return this.fail('not_found', result.error)
    if (!result.state || typeof result.state !== 'object' || Array.isArray(result.state)) {
      return this.fail('not_found', `state file is not a JSON object: ${taskId}`)
    }
    return this.ok({ state: result.state })
  }

  async listArtifacts({ taskId, project }: { taskId: string; project?: string }): Promise<any> {
    const bad = this.badTaskId(taskId)
    if (bad) return bad
    const gate = this.requireRoot(project)
    if ('error' in gate) return gate.error

    const taskDir = resolvePathUnder(gate.root, 'tasks', taskId)
    if (!taskDir) return this.fail('invalid_input', 'task path escapes the project root')

    const cfg = await loadPipelineConfig(gate.root, taskId)
    const { artifacts, subtasks } = await listArtifacts(taskDir, knownArtifactsFor(cfg))
    return this.ok({ artifacts, subtasks })
  }

  async readArtifact(
    { taskId, name, project }: { taskId: string; name: string; project?: string },
    maxChars?: number,
  ): Promise<any> {
    const bad = this.badTaskId(taskId)
    if (bad) return bad
    if (typeof name !== 'string' || !name || name.includes('\0')) {
      return this.fail('invalid_input', 'artifact name is required and must not contain a null byte')
    }
    const gate = this.requireRoot(project)
    if ('error' in gate) return gate.error

    const file = resolveArtifact(gate.root, taskId, name)
    if (!file) return this.fail('invalid_input', 'artifact path escapes the task directory')

    const meta = await statSafe(file)
    if (!meta.exists) return this.fail('not_found', `artifact not found: ${name}`)

    let content: string
    try {
      content = await readTextFile(file, maxChars)
    } catch (err: any) {
      return this.fail('not_found', `cannot read artifact ${name}: ${err && err.message ? err.message : err}`)
    }

    return this.ok({ name, content, mtime: meta.mtime }, { structured: false })
  }

  async createQa({
    taskId,
    questions,
    project,
  }: {
    taskId: string
    questions: Array<{ prompt?: string; choices?: string[] }>
    project?: string
  }): Promise<any> {
    const bad = this.badTaskId(taskId)
    if (bad) return bad
    const gate = this.requireRoot(project)
    if ('error' in gate) return gate.error
    const result = await createQa(gate.root, taskId, { questions })
    if ('error' in result) return this.fail('invalid_input', result.error)
    return this.ok(result)
  }

  async getTaskContext({
    taskId,
    project,
    include,
  }: { taskId: string; project?: string; include?: string[] }): Promise<any> {
    const bad = this.badTaskId(taskId)
    if (bad) return bad

    const sections: readonly string[] = include ?? DEFAULT_TASK_CONTEXT_SECTIONS
    const badSection = this.badContextSections(sections)
    if (badSection) return badSection

    const gate = this.requireRoot(project)
    if ('error' in gate) return gate.error
    const root = gate.root
    const wants = (section: string) => sections.includes(section)

    let rulesFile: string | null = null
    if (wants('rules')) {
      const resolved = this.resolveRulesFile(root)
      if ('error' in resolved) return resolved.error
      rulesFile = resolved.file
    }

    const parts = await this.loadContextParts(taskId, project, root, rulesFile, wants)

    return this.ok(buildContextPayload(taskId, parts, wants), { structured: false })
  }

  private badTaskId(taskId: string): any | null {
    if (isSafeTaskId(taskId)) return null
    return this.fail('invalid_input', `invalid task id: ${JSON.stringify(taskId)}`)
  }

  private badContextSections(sections: readonly string[]): any | null {
    if (!Array.isArray(sections)) return this.fail('invalid_input', 'include must be an array')
    for (const section of sections) {
      if (!(TASK_CONTEXT_SECTIONS as readonly string[]).includes(section)) {
        return this.fail(
          'invalid_input',
          `unknown include section: ${JSON.stringify(section)} — expected one of ${TASK_CONTEXT_SECTIONS.join(', ')}`,
        )
      }
    }
    return null
  }

  private resolveRulesFile(root: string): { file: string | null } | { error: any } {
    const direct = resolvePathUnder(root, 'project-rules.md')
    if (!direct) return { error: this.fail('invalid_input', 'rules path escapes the project root') }

    try {
      const realRoot = realpathSync(root)
      const realFile = realpathSync(direct)
      if (!resolvePathUnder(realRoot, realFile)) {
        return { error: this.fail('invalid_input', 'rules path escapes the project root') }
      }
      return { file: realFile }
    } catch {
      return { file: null }
    }
  }

  private async loadContextParts(
    taskId: string,
    project: string | undefined,
    root: string,
    rulesFile: string | null,
    wants: (section: string) => boolean,
  ): Promise<TaskContextParts> {
    const needState = wants('state') || wants('pipeline')
    const [state, artifacts, request, pipelineCfg, rules] = await Promise.all([
      needState ? this.getTaskState({ taskId, project }).then(payloadOf, () => null) : null,
      wants('artifacts') ? this.listArtifacts({ taskId, project }).then(payloadOf, () => null) : null,
      wants('request')
        ? this.readArtifact(
            { taskId, name: 'request.md', project },
            TASK_CONTEXT_MAX_CHARS + 1,
          ).then(payloadOf, () => null)
        : null,
      wants('pipeline') ? loadPipelineConfig(root, taskId).catch(() => null) : null,
      rulesFile ? readTextFile(rulesFile, TASK_CONTEXT_MAX_CHARS + 1).catch(() => null) : null,
    ])
    return { state, artifacts, request, pipelineCfg, rules: rules ?? null }
  }
}
