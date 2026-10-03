// xem docs/mcp/server.md §8.1, §8.2
import { resolveProjectRoot } from '../../src/backend/registry.js'
import { readTextFile, realpathSync, resolvePathUnder, statSafe } from '../../src/backend/lib/fileHelper.js'
import { knownArtifactsFor, loadPipelineConfig } from '../../src/features/monitor/business/peers.js'
import { createQa } from '../../src/features/monitor/business/tasks/qa.js'
import {
  collectTasks,
  listArtifacts,
  readState,
  resolveArtifact,
} from '../../src/features/monitor/business/tasks/reads.js'
import { fail, ok } from '../envelope.js'
import { DEFAULT_TASK_CONTEXT_SECTIONS, isSafeTaskId, TASK_CONTEXT_SECTIONS } from '../schemas.js'

const DEFAULT_TASK_LIMIT = 50

type RootGate = { root: string } | { error: any }

export function rootOrFail(project?: string): RootGate {
  const root = resolveProjectRoot(project ?? null)
  if (root) return { root }
  return {
    error: fail(
      'not_found',
      project
        ? `unknown project: ${project}`
        : 'no default project — call list_projects, or set DEV_TEAM_ROOT / DEV_TEAM_DASHBOARD_HOME for this process',
    ),
  }
}

function badTaskId(taskId: string): any | null {
  if (isSafeTaskId(taskId)) return null
  return fail('invalid_input', `invalid task id: ${JSON.stringify(taskId)}`)
}

function statusOf(hitlPending: string | null, phase: string | null): 'running' | 'waiting' | 'completed' {
  if (hitlPending !== null) return 'waiting'
  if (phase === 'completed') return 'completed'
  return 'running'
}

export async function handleListTasks({
  project,
  status,
  limit,
}: { project?: string; status?: 'running' | 'waiting' | 'completed'; limit?: number } = {}): Promise<any> {
  const gate = rootOrFail(project)
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

  return ok({ tasks: sorted.slice(0, limit ?? DEFAULT_TASK_LIMIT), total })
}

export async function handleGetTaskState({
  taskId,
  project,
}: { taskId: string; project?: string }): Promise<any> {
  const bad = badTaskId(taskId)
  if (bad) return bad
  const gate = rootOrFail(project)
  if ('error' in gate) return gate.error

  const stateFile = resolvePathUnder(gate.root, '.dev-state', `${taskId}.json`)
  if (!stateFile) return fail('invalid_input', 'state path escapes the project root')

  const result = await readState(stateFile)
  if ('error' in result) return fail('not_found', result.error)
  if (!result.state || typeof result.state !== 'object' || Array.isArray(result.state)) {
    return fail('not_found', `state file is not a JSON object: ${taskId}`)
  }
  return ok({ state: result.state })
}

export async function handleListArtifacts({
  taskId,
  project,
}: { taskId: string; project?: string }): Promise<any> {
  const bad = badTaskId(taskId)
  if (bad) return bad
  const gate = rootOrFail(project)
  if ('error' in gate) return gate.error

  const taskDir = resolvePathUnder(gate.root, 'tasks', taskId)
  if (!taskDir) return fail('invalid_input', 'task path escapes the project root')

  const cfg = await loadPipelineConfig(gate.root, taskId)
  const { artifacts, subtasks } = await listArtifacts(taskDir, knownArtifactsFor(cfg))
  return ok({ artifacts, subtasks })
}

export async function handleReadArtifact({
  taskId,
  name,
  project,
}: { taskId: string; name: string; project?: string }, maxChars?: number): Promise<any> {
  const bad = badTaskId(taskId)
  if (bad) return bad
  if (typeof name !== 'string' || !name || name.includes('\0')) {
    return fail('invalid_input', 'artifact name is required and must not contain a null byte')
  }
  const gate = rootOrFail(project)
  if ('error' in gate) return gate.error

  const file = resolveArtifact(gate.root, taskId, name)
  if (!file) return fail('invalid_input', 'artifact path escapes the task directory')

  const meta = await statSafe(file)
  if (!meta.exists) return fail('not_found', `artifact not found: ${name}`)

  let content: string
  try {
    content = await readTextFile(file, maxChars)
  } catch (err: any) {
    return fail('not_found', `cannot read artifact ${name}: ${err && err.message ? err.message : err}`)
  }

  return ok({ name, content, mtime: meta.mtime }, { structured: false })
}

export async function handleCreateQa({
  taskId,
  questions,
  project,
}: {
  taskId: string
  questions: Array<{ prompt?: string; choices?: string[] }>
  project?: string
}): Promise<any> {
  const bad = badTaskId(taskId)
  if (bad) return bad
  const gate = rootOrFail(project)
  if ('error' in gate) return gate.error
  const result = await createQa(gate.root, taskId, { questions })
  if ('error' in result) return fail('invalid_input', result.error)
  return ok(result)
}

const TASK_CONTEXT_MAX_CHARS = 64 * 1024

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

function badContextSections(sections: readonly string[]): any | null {
  if (!Array.isArray(sections)) return fail('invalid_input', 'include must be an array')
  for (const section of sections) {
    if (!(TASK_CONTEXT_SECTIONS as readonly string[]).includes(section)) {
      return fail(
        'invalid_input',
        `unknown include section: ${JSON.stringify(section)} — expected one of ${TASK_CONTEXT_SECTIONS.join(', ')}`,
      )
    }
  }
  return null
}

function resolveRulesFile(root: string): { file: string | null } | { error: any } {
  const direct = resolvePathUnder(root, 'project-rules.md')
  if (!direct) return { error: fail('invalid_input', 'rules path escapes the project root') }

  try {
    const realRoot = realpathSync(root)
    const realFile = realpathSync(direct)
    if (!resolvePathUnder(realRoot, realFile)) {
      return { error: fail('invalid_input', 'rules path escapes the project root') }
    }
    return { file: realFile }
  } catch {
    return { file: null }
  }
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

type TaskContextParts = {
  state: any
  artifacts: any
  request: any
  pipelineCfg: any
  rules: string | null
}

async function loadContextParts(
  taskId: string,
  project: string | undefined,
  root: string,
  rulesFile: string | null,
  wants: (section: string) => boolean,
): Promise<TaskContextParts> {
  const needState = wants('state') || wants('pipeline')
  const [state, artifacts, request, pipelineCfg, rules] = await Promise.all([
    needState ? handleGetTaskState({ taskId, project }).then(payloadOf, () => null) : null,
    wants('artifacts') ? handleListArtifacts({ taskId, project }).then(payloadOf, () => null) : null,
    wants('request')
      ? handleReadArtifact(
          { taskId, name: 'request.md', project },
          TASK_CONTEXT_MAX_CHARS + 1,
        ).then(payloadOf, () => null)
      : null,
    wants('pipeline') ? loadPipelineConfig(root, taskId).catch(() => null) : null,
    rulesFile ? readTextFile(rulesFile, TASK_CONTEXT_MAX_CHARS + 1).catch(() => null) : null,
  ])
  return { state, artifacts, request, pipelineCfg, rules: rules ?? null }
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

export async function handleGetTaskContext({
  taskId,
  project,
  include,
}: { taskId: string; project?: string; include?: string[] }): Promise<any> {
  const bad = badTaskId(taskId)
  if (bad) return bad

  const sections: readonly string[] = include ?? DEFAULT_TASK_CONTEXT_SECTIONS
  const badSection = badContextSections(sections)
  if (badSection) return badSection

  const gate = rootOrFail(project)
  if ('error' in gate) return gate.error
  const root = gate.root
  const wants = (section: string) => sections.includes(section)

  let rulesFile: string | null = null
  if (wants('rules')) {
    const resolved = resolveRulesFile(root)
    if ('error' in resolved) return resolved.error
    rulesFile = resolved.file
  }

  const parts = await loadContextParts(taskId, project, root, rulesFile, wants)

  return ok(
    buildContextPayload(taskId, parts, wants),
    { structured: false },
  )
}
