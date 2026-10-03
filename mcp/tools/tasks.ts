// 5 tool đọc nhóm task/artifact (P2) + 1 tool ghi `create_qa` kế thừa từ 1.1.8.
// Đường ghi duy nhất cho task là `create_qa`; `write_artifact` / `decide_hitl`
// vẫn hoãn sang 1.3.0 (Tb4241005 D8).
//
// Import `monitor/business/tasks/reads.js` chứ KHÔNG phải `tasks/index.js`:
// barrel đầy đủ re-export `runStep.js` → runner → job queue + sqlite +
// `node:child_process`, kéo cả vào tiến trình stdio và giữ event loop sống.
//
// 🚫 Cấm `joinPath` trong `mcp/` (G10, bất biến AGENTS.md §4). Mọi path dựng từ
// input agent phải đi qua `resolvePathUnder` hoặc `resolveArtifact` — cả hai trả
// `null` khi target thoát khỏi base — CỘNG `isSafeTaskId` ở lớp thứ hai.

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

// Narrow bằng `'error' in gate`, không bằng cờ boolean: narrowing theo
// discriminant boolean misbehave dưới `vue-tsc` (AGENTS.md §4).
type RootGate = { root: string } | { error: any }

/**
 * Root của project, hoặc một `fail` đã dựng sẵn.
 *
 * Thông điệp nêu rõ cách tự phục hồi (gỡ L9) — agent chỉ có dòng text này để
 * biết phải làm gì tiếp. 🚫 KHÔNG vá bằng `cwd/..`: MCP chạy không có cwd cố định,
 * đoán bừa root là đọc nhầm project.
 */
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

/** `waiting` thắng `completed`: HITL đang chờ là trạng thái người vận hành cần thấy. */
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
  // `total` đếm SAU lọc `status`, TRƯỚC khi cắt `limit` (E14) — agent cần biết
  // còn bao nhiêu ngoài trang này.
  const total = filtered.length

  // Mới nhất trước; task chưa có state file (`updatedAt === null`) xuống cuối.
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

  // 🚫 KHÔNG dùng `stateFileOf`: nó dựng path bằng `joinPath`, không sanitize (E3).
  const stateFile = resolvePathUnder(gate.root, '.dev-state', `${taskId}.json`)
  if (!stateFile) return fail('invalid_input', 'state path escapes the project root')

  const result = await readState(stateFile)
  if ('error' in result) return fail('not_found', result.error)
  // `outputSchema` khai `state` là object; state file chứa mảng/số sẽ làm SDK
  // ném `McpError` giữa đường — chặn ở đây để lỗi đi ra dưới dạng `fail`.
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

  // Task chưa có thư mục artifact KHÔNG phải lỗi, nhưng cũng KHÔNG ra danh sách
  // artifact known: `listArtifacts` thoát sớm ngay khi `readDir` ném
  // (`tasks/reads.ts`) nên trả map RỖNG, chưa chạy tới vòng bù artifact known.
  // Map rỗng đó mới là thứ đi ra — hình dạng vẫn hợp lệ, agent phân biệt "task
  // chưa có gì" với "task có artifact" qua chính việc map rỗng.
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

  // G10: bắt buộc qua `resolveArtifact` — trả `null` khi path thoát khỏi thư
  // mục task, nên `name = '../../.dev-state/x.json'` không bao giờ được đọc.
  const file = resolveArtifact(gate.root, taskId, name)
  if (!file) return fail('invalid_input', 'artifact path escapes the task directory')

  const meta = await statSafe(file)
  if (!meta.exists) return fail('not_found', `artifact not found: ${name}`)

  let content: string
  try {
    content = await readTextFile(file, maxChars)
  } catch (err: any) {
    // `name` trỏ thư mục (EISDIR) hoặc file không đọc được — trả `fail` chứ
    // không để lỗi thoát ra thành `McpError`.
    return fail('not_found', `cannot read artifact ${name}: ${err && err.message ? err.message : err}`)
  }

  // G8: không `structuredContent` — artifact có thể lớn, nhân đôi qua stdio là lãng phí.
  return ok({ name, content, mtime: meta.mtime }, { structured: false })
}

/**
 * Điểm vào MCP cho `create_qa` — cùng gọi `createQa()` với `POST /api/tasks/:id/qa`
 * nên hai đường không lệch khuôn `qa.md`.
 *
 * `questions` khai lỏng ở type vì nested array-of-object bị `ShapeOutput` của SDK
 * narrow thành optional, không phản ánh dữ liệu runtime thật. `createQa()` tự
 * `safeParse` lại nên vẫn an toàn khi field thiếu.
 */
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

// ── get_task_context ─────────────────────────────────────────────────────────

/**
 * Cap on `request.md` / `project-rules.md` content, in characters. Same reasoning
 * as the artifact cap: the payload crosses stdio, so an unbounded file would make
 * one tool call cost more than the Bash chain it replaces.
 */
const TASK_CONTEXT_MAX_CHARS = 64 * 1024

/**
 * Unwrap a tool envelope into its payload, or `null` when the branch failed.
 *
 * Branch failures are deliberately swallowed: a task with no `request.md` yet, or
 * a broken `pipeline.yaml`, is a valid state that must not take the whole tool
 * down with it.
 */
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

/**
 * Clip a file body to the context budget and SAY whether it was clipped.
 *
 * The flag is the point: an agent handed a silently truncated `request.md` would
 * act on half a spec without ever knowing a second half existed.
 */
function capped(content: string): { content: string; truncated: boolean } {
  if (content.length <= TASK_CONTEXT_MAX_CHARS) return { content, truncated: false }
  return { content: content.slice(0, TASK_CONTEXT_MAX_CHARS), truncated: true }
}

/** Step list reduced to what an agent needs to know about where it is. */
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

/**
 * `include` may only name sections this tool knows.
 *
 * An unknown name is a client bug, and answering it with a payload that silently
 * omits the section would hide that bug behind an empty-looking task.
 *
 * Returns a `fail` payload, or `null` when every section is known.
 */
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

/**
 * Resolve `project-rules.md` to a path proven to sit inside the project root.
 *
 * Two checks, not one. `resolvePathUnder` compares the LEXICAL path, so a
 * `project-rules.md` that is a symlink out of the root passes it and `readTextFile`
 * would then happily return a file from anywhere on disk. Resolving BOTH sides with
 * `realpathSync` and re-checking is what actually closes that, and the caller must
 * read the returned `file` — re-deriving the path would drop the proof.
 *
 * `{ file: null }` means "no rules to report" (missing file, broken symlink);
 * `{ error }` means the path escaped and the whole call must fail.
 */
function resolveRulesFile(root: string): { file: string | null } | { error: any } {
  // 🚫 No `joinPath` in `mcp/` — `resolvePathUnder` returns null when the target
  // escapes the root, and that is a `fail`, not a silent read somewhere else.
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

/** `{ content, truncated }` for a file section, or `null` when it was not read. */
function fileSection(name: string, content: unknown, extra?: Record<string, unknown>): any {
  return typeof content === 'string' ? { name, ...extra, ...capped(content) } : null
}

/** The four task fields the bootstrap call needs, or `null` when state is unreadable. */
function taskSummary(taskId: string, stateObj: any): any {
  if (!stateObj) return null
  return {
    id: taskId,
    name: stateObj.name ?? null,
    phase: stateObj.current_phase ?? null,
    hitlPending: stateObj.hitl_pending ?? null,
  }
}

/** What `loadContextParts` fans out to — one slot per section, `null` when not asked for. */
type TaskContextParts = {
  state: any
  artifacts: any
  request: any
  pipelineCfg: any
  rules: string | null
}

/**
 * Fan out the four existing handlers plus the rules read, in parallel.
 *
 * Every branch swallows its own rejection: one unreadable section must degrade to
 * `null` in that slot rather than fail the whole bootstrap call, which is the only
 * reason an agent would still have to fall back to `cd && cat`.
 */
async function loadContextParts(
  taskId: string,
  project: string | undefined,
  root: string,
  rulesFile: string | null,
  wants: (section: string) => boolean,
): Promise<TaskContextParts> {
  // `state` is loaded for `pipeline` too — `summarisePipeline` needs `current_phase`
  // to say which step is current — but it is only REPORTED when asked for.
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

/** Shape the fanned-out parts into the wire payload. */
function buildContextPayload(
  taskId: string,
  parts: TaskContextParts,
  wants: (section: string) => boolean,
): any {
  const { state, artifacts, request, pipelineCfg, rules } = parts
  const stateObj = state?.state ?? null
  // `untrusted` means the YAML was there but unreadable. Reporting the built-in
  // default as if it were the task's pipeline would be worse than saying nothing.
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
    // Same `{ content, truncated }` shape as `request`: an agent handed a
    // silently clipped `project-rules.md` has no way to tell, and one branch of
    // the payload reporting truncation while its neighbour hides it is worse
    // than neither doing so.
    rules: fileSection('project-rules.md', rules),
  }
}

/**
 * Whole context of one task in ONE call: `request.md`, the pipeline (current +
 * next step), the artifact listing, and the machine state.
 *
 * No new algorithm — it is a fan-out over handlers that already exist. The value
 * is in the round trips it removes: 21 of 25 measured sessions opened with the
 * exact `cd <task-dir> && cat request.md && cat pipeline.yaml && ls -la` chain
 * this replaces, and because the tool takes a `taskId` there is no `cd` at all.
 */
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
    // G8: same reasoning as `read_artifact` — the payload carries file contents,
    // and `structuredContent` would send every byte of it twice over stdio.
    { structured: false },
  )
}
