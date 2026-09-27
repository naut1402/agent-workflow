// 4 tool đọc nhóm task/artifact (P2). Toàn bộ read-only — 1.2.0 không mở đường
// ghi nào cho task (D8).
//
// Import `monitor/business/tasks/reads.js` chứ KHÔNG phải `tasks/index.js`:
// barrel đầy đủ re-export `runStep.js` → runner → job queue + sqlite +
// `node:child_process`, kéo cả vào tiến trình stdio và giữ event loop sống.
//
// 🚫 Cấm `joinPath` trong `mcp/` (G10, bất biến AGENTS.md §4). Mọi path dựng từ
// input agent phải đi qua `resolvePathUnder` hoặc `resolveArtifact` — cả hai trả
// `null` khi target thoát khỏi base — CỘNG `isSafeTaskId` ở lớp thứ hai.

import { resolveProjectRoot } from '../../src/backend/registry.js'
import { readTextFile, resolvePathUnder, statSafe } from '../../src/backend/lib/fileHelper.js'
import { knownArtifactsFor, loadPipelineConfig } from '../../src/features/monitor/business/peers.js'
import {
  collectTasks,
  listArtifacts,
  readState,
  resolveArtifact,
} from '../../src/features/monitor/business/tasks/reads.js'
import { fail, ok } from '../envelope.js'
import { isSafeTaskId } from '../schemas.js'

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
}: { taskId: string; name: string; project?: string }): Promise<any> {
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
    content = await readTextFile(file)
  } catch (err: any) {
    // `name` trỏ thư mục (EISDIR) hoặc file không đọc được — trả `fail` chứ
    // không để lỗi thoát ra thành `McpError`.
    return fail('not_found', `cannot read artifact ${name}: ${err && err.message ? err.message : err}`)
  }

  // G8: không `structuredContent` — artifact có thể lớn, nhân đôi qua stdio là lãng phí.
  return ok({ name, content, mtime: meta.mtime }, { structured: false })
}
