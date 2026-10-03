// Tb4241005 · TC-49 … TC-84 — 4 tool đọc nhóm task/artifact (P2).
//
// Toàn bộ read-only: 1.2.0 không mở đường ghi nào cho task (D8).
// Trọng tâm là hai thứ không nhìn thấy bằng mắt: bảng quyết định `status` +
// `total`/`limit` (E14), và path-traversal qua `taskId` / `name` (E3/E4/G10).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { add } from '../../src/backend/registry'
import { DashboardMcpServer } from '../../mcp/DashboardMcpServer'
import { TaskTools } from '../../mcp/tools/TaskTools'

const taskTools = new TaskTools(DashboardMcpServer.resolveRoot)

// ── Cô lập env — BỐN biến (§1.4) ──────────────────────────────────────────────

const ISOLATED = [
  'DEV_TEAM_DASHBOARD_HOME',
  'DEV_TEAM_ROOT',
  'DEVTEAM_MCP_MODE',
  'DEVTEAM_MCP_PROJECT',
] as const

const saved: Record<string, string | undefined> = {}
let home: string
let tmpDirs: string[] = []

beforeEach(() => {
  for (const key of ISOLATED) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  home = mkTmp('mcp-home-')
  // registryHome() CHÍNH LÀ giá trị này (đã resolve) — `projects.json` nằm ngay
  // dưới đây, không phải dưới `$HOME/.dev-team-dashboard`.
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})

afterEach(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true })
  tmpDirs = []
  for (const key of ISOLATED) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

function mkTmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

// ── Fixture ───────────────────────────────────────────────────────────────────

type RootSpec = {
  /** `.dev-state/<id>.json` — object thì stringify, string thì ghi thô (để dựng JSON hỏng). */
  states?: Record<string, unknown>
  /** `tasks/<id>/<file>` — key kết thúc bằng `/` là thư mục rỗng (subtask). */
  tasks?: Record<string, Record<string, string>>
  /** File ngoài `tasks/` — đích thật cho case traversal "đọc trộm". */
  loose?: Record<string, string>
}

/** Dựng một `.dev-team-agent` root trong thư mục tạm. */
function makeRoot(spec: RootSpec = {}, prefix = 'mcp-root-'): string {
  const root = mkTmp(prefix)
  const entries = Object.entries(spec.states ?? {})
  if (entries.length) fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  for (const [id, value] of entries) {
    const raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    fs.writeFileSync(path.join(root, '.dev-state', `${id}.json`), raw)
  }
  for (const [id, files] of Object.entries(spec.tasks ?? {})) {
    const dir = path.join(root, 'tasks', id)
    fs.mkdirSync(dir, { recursive: true })
    for (const [name, content] of Object.entries(files)) {
      if (name.endsWith('/')) {
        fs.mkdirSync(path.join(dir, name), { recursive: true })
        continue
      }
      fs.writeFileSync(path.join(dir, name), content)
    }
  }
  for (const [name, content] of Object.entries(spec.loose ?? {})) {
    fs.writeFileSync(path.join(root, name), content)
  }
  return root
}

const SECRET = 'SUPER-SECRET-NEEDLE-1a2b3c'

/** Fixture §1.5 — 5 task phủ đủ 3 nhánh status + state hỏng + task chỉ-có-dir. */
function standardRoot(): string {
  return makeRoot({
    states: {
      'task-a': { task_id: 'task-a', name: 'Task A', current_phase: 'implementer' },
      'task-b': { task_id: 'task-b', name: 'Task B', current_phase: 'completed' },
      'task-c': { task_id: 'task-c', name: 'Task C', current_phase: 'investigator', hitl_pending: 'hitl-1' },
      'task-d': '{ broken',
      'task-e': { task_id: 'task-e', name: 'Task E', current_phase: 'designer' },
    },
    tasks: {
      'task-a': {
        'request.md': '# Yêu cầu\nNội dung có dấu tiếng Việt\n',
        'design.md': '# Thiết kế\n',
        'sub-1/': '',
      },
      'task-b': { 'request.md': '# B\n' },
    },
    loose: { 'secret.txt': SECRET },
  })
}

/** Root fixture + trỏ `DEV_TEAM_ROOT` vào nó (registry rỗng ⇒ đây là default). */
function useRoot(spec?: RootSpec): string {
  const root = spec ? makeRoot(spec) : standardRoot()
  process.env.DEV_TEAM_ROOT = root
  return root
}

const payload = (r: any) => JSON.parse(r.content[0].text)
// Hợp đồng lỗi (bản vá B1, commit 900d78d): mã lỗi ở `_meta.error`.
const codeOf = (r: any) => r._meta?.error?.code

/** Client MCP in-memory — cần khi muốn quan sát TẦNG VALIDATE INPUT. */
async function withClient<T>(fn: (client: Client) => Promise<T>, mode: 'readonly' | 'full' = 'full'): Promise<T> {
  const server = new DashboardMcpServer(mode).build()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'tools-tasks-test', version: '1.0.0' })
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  try {
    return await fn(client)
  } finally {
    await client.close()
    await server.close()
  }
}

async function callRaw(client: Client, name: string, args: Record<string, unknown>): Promise<any> {
  return client.callTool({ name, arguments: args })
}

/**
 * **Tầng T1 — validate input của SDK.** Đầu vào vi phạm `TASK_ID_PATTERN` hoặc
 * biên schema bị chặn TRƯỚC khi handler chạy.
 *
 * ⚠️ Spec mô tả T1 là `callTool` **ném** và bảo assert bằng `.rejects`. Thực tế
 * SDK 1.29.0 **không ném**: `server/mcp.js` bắt `McpError` của
 * `validateToolInput` ngay trong cùng `try` rồi trả `createToolError(...)`, nên
 * client nhận một `CallToolResult` có `isError` và chuỗi `-32602 Input
 * validation error` nằm TRONG `content[0].text`. Xem test-result.md › Lệch spec.
 *
 * Helper nhận cả hai hình dạng — cùng một bất biến "bị chặn ở T1" — nhưng assert
 * chặt trong từng nhánh: cấm `ok`, cấm `_meta.error` (handler chưa chạy nên
 * không có envelope `fail` nào được dựng), và thông điệp phải nói về validate.
 */
async function expectT1(call: Promise<any>) {
  let res: any
  try {
    res = await call
  } catch (err: any) {
    expect(err?.code).toBe(-32602)
    expect(String(err?.message)).toContain('Input validation error')
    return
  }
  expect(res.isError).toBe(true)
  expect(res.structuredContent).toBeUndefined()
  expect(res._meta?.error).toBeUndefined()
  expect(String(res.content[0].text)).toContain('Input validation error')
}

// ── C.1 · list_tasks ──────────────────────────────────────────────────────────

describe('list_tasks', () => {
  test('TC-49: liệt kê mặc định — đúng bộ khoá, có total', async () => {
    useRoot()
    const res = await taskTools.listTasks({})
    expect(res.isError).toBeUndefined()
    const sc = res.structuredContent
    expect(sc.total).toBe(5)
    expect(sc.tasks).toHaveLength(5)
    for (const task of sc.tasks) {
      expect(Object.keys(task).sort()).toEqual(['hitlPending', 'id', 'name', 'phase', 'updatedAt'])
    }
    const byId = Object.fromEntries(sc.tasks.map((t: any) => [t.id, t]))
    expect(byId['task-a'].name).toBe('Task A')
    expect(byId['task-a'].phase).toBe('implementer')
    expect(byId['task-c'].hitlPending).toBe('hitl-1')
  })

  test("TC-50: status 'waiting' — chỉ task có gate đang chờ", async () => {
    useRoot()
    const ids = (await taskTools.listTasks({ status: 'waiting' })).structuredContent.tasks.map((t: any) => t.id)
    expect(ids).toContain('task-c')
    expect(ids).not.toContain('task-a')
    expect(ids).not.toContain('task-b')
  })

  test("TC-51: status 'completed'", async () => {
    useRoot()
    const ids = (await taskTools.listTasks({ status: 'completed' })).structuredContent.tasks.map((t: any) => t.id)
    expect(ids).toContain('task-b')
    expect(ids).not.toContain('task-a')
    expect(ids).not.toContain('task-c')
  })

  test("TC-52: status 'running' — phần còn lại", async () => {
    useRoot()
    const ids = (await taskTools.listTasks({ status: 'running' })).structuredContent.tasks.map((t: any) => t.id)
    expect(ids).toContain('task-a')
    expect(ids).toContain('task-e')
    expect(ids).not.toContain('task-b')
    expect(ids).not.toContain('task-c')
  })

  test('TC-53 (điều chỉnh): gate cũ trên task completed đã được chuẩn hoá trước khi tới status', async () => {
    // ⚠️ Lệch spec — spec dựng `task-f` có ĐỒNG THỜI `phase === 'completed'` và
    // `hitlPending !== null` rồi đòi nó ra ở `waiting`. Tổ hợp đó KHÔNG dựng
    // được từ ngoài: `collectTasks` chạy `resolveHitlPending`, và hàm đó trả
    // `null` cho mọi task có `current_phase === 'completed'` (phase.ts:93) —
    // một pipeline đã xong thì không còn bước nào giữ gate. Nên thứ tự ưu tiên
    // trong `statusOf` không quan sát được; cái quan sát được là bất biến này.
    useRoot({
      states: {
        'task-f': { task_id: 'task-f', current_phase: 'completed', hitl_pending: 'hitl-3' },
      },
    })
    const all = (await taskTools.listTasks({})).structuredContent.tasks
    expect(all.find((t: any) => t.id === 'task-f').hitlPending).toBeNull()

    const idsIn = async (status: 'running' | 'waiting' | 'completed') =>
      (await taskTools.listTasks({ status })).structuredContent.tasks.map((t: any) => t.id)
    expect(await idsIn('completed')).toContain('task-f')
    expect(await idsIn('waiting')).not.toContain('task-f')
    expect(await idsIn('running')).not.toContain('task-f')
  })

  test('TC-54: ba nhánh status rời nhau và phủ kín', async () => {
    useRoot()
    const all = (await taskTools.listTasks({})).structuredContent.tasks.map((t: any) => t.id)
    const buckets = await Promise.all(
      (['running', 'waiting', 'completed'] as const).map(async (status) =>
        (await taskTools.listTasks({ status })).structuredContent.tasks.map((t: any) => t.id),
      ),
    )
    const union = buckets.flat()
    expect(new Set(union).size).toBe(union.length)
    expect([...union].sort()).toEqual([...all].sort())
  })

  test('TC-55: sắp xếp updatedAt giảm dần, null xuống cuối', async () => {
    const root = useRoot()
    // Task chỉ có thư mục, không có state file ⇒ `updatedAt === null`.
    fs.mkdirSync(path.join(root, 'tasks', 'task-nostate'), { recursive: true })
    // Nới mtime để thứ tự xác định, không phụ thuộc độ phân giải của fs.
    const stateDir = path.join(root, '.dev-state')
    const order = ['task-a', 'task-b', 'task-c', 'task-d', 'task-e']
    order.forEach((id, i) => {
      const when = new Date(Date.now() - (order.length - i) * 60_000)
      fs.utimesSync(path.join(stateDir, `${id}.json`), when, when)
    })

    const tasks = (await taskTools.listTasks({})).structuredContent.tasks
    const times = tasks.map((t: any) => t.updatedAt)
    const nonNull = times.filter((v: number | null) => v !== null)
    expect(nonNull).toEqual([...nonNull].sort((a: number, b: number) => b - a))
    expect(times.slice(nonNull.length).every((v: number | null) => v === null)).toBe(true)
    expect(tasks[tasks.length - 1].id).toBe('task-nostate')
  })

  test('TC-56: limit cắt danh sách nhưng KHÔNG đổi total', async () => {
    useRoot()
    const res = await taskTools.listTasks({ limit: 2 })
    expect(res.structuredContent.tasks).toHaveLength(2)
    expect(res.structuredContent.total).toBe(5)
  })

  test('TC-57: total tính SAU lọc status, TRƯỚC khi cắt limit', async () => {
    useRoot({
      states: {
        w1: { current_phase: 'investigator', hitl_pending: 'hitl-1' },
        w2: { current_phase: 'investigator', hitl_pending: 'hitl-1' },
        w3: { current_phase: 'designer', hitl_pending: 'hitl-2' },
        r1: { current_phase: 'implementer' },
        c1: { current_phase: 'completed' },
      },
    })
    const res = await taskTools.listTasks({ status: 'waiting', limit: 1 })
    expect(res.structuredContent.tasks).toHaveLength(1)
    // Không phải 5 (chưa lọc), cũng không phải 1 (đã cắt).
    expect(res.structuredContent.total).toBe(3)
  })

  test('TC-58: limit lớn hơn số task', async () => {
    useRoot()
    const res = await taskTools.listTasks({ limit: 200 })
    expect(res.structuredContent.tasks).toHaveLength(5)
    expect(res.structuredContent.total).toBe(5)
  })

  test('TC-59: biên của limit ở tầng validate input', async () => {
    useRoot()
    await withClient(async (client) => {
      for (const limit of [1, 200]) {
        const res: any = await callRaw(client, 'list_tasks', { limit })
        expect(res.isError).toBeFalsy()
      }
      for (const limit of [0, 201, 1.5, -1]) {
        await expectT1(callRaw(client, 'list_tasks', { limit }))
      }
    })
  })

  test('TC-60: root rỗng hoàn toàn → { tasks: [], total: 0 }, không ném', async () => {
    useRoot({})
    const res = await taskTools.listTasks({})
    expect(res.isError).toBeUndefined()
    expect(res.structuredContent).toEqual({ tasks: [], total: 0 })
  })

  test('TC-61: state hỏng JSON vẫn được liệt kê, phase null', async () => {
    useRoot()
    const res = await taskTools.listTasks({})
    expect(res.isError).toBeUndefined()
    const broken = res.structuredContent.tasks.find((t: any) => t.id === 'task-d')
    expect(broken).toBeTruthy()
    expect(broken.phase).toBeNull()
  })

  test('TC-62: project không tồn tại → not_found, text nhắc tên project', async () => {
    useRoot()
    const res = await taskTools.listTasks({ project: 'khong-co' })
    expect(res.isError).toBe(true)
    expect(codeOf(res)).toBe('not_found')
    expect(res.content[0].text).toContain('khong-co')
  })

  test('TC-63: không có default project → not_found, thông điệp tự-phục-hồi', async () => {
    // Registry rỗng (`DEV_TEAM_DASHBOARD_HOME` là thư mục tạm trống) và
    // `DEV_TEAM_ROOT` không đặt. Chốt luôn: KHÔNG có fallback ngầm sang cwd,
    // kể cả khi cwd của tiến trình test là một dev-team root thật.
    delete process.env.DEV_TEAM_ROOT
    const res = await taskTools.listTasks({})
    expect(res.isError).toBe(true)
    expect(codeOf(res)).toBe('not_found')
    const text: string = res.content[0].text
    expect(text).toContain('default project')
    expect(text).toContain('list_projects')
    expect(text).toContain('DEV_TEAM_ROOT')
  })
})

// ── C.2 · get_task_state ──────────────────────────────────────────────────────

describe('get_task_state', () => {
  test('TC-64: đọc state hợp lệ', async () => {
    useRoot()
    const res = await taskTools.getTaskState({ taskId: 'task-a' })
    expect(res.isError).toBeUndefined()
    expect(res.structuredContent.state).toEqual({
      task_id: 'task-a',
      name: 'Task A',
      current_phase: 'implementer',
    })
  })

  test('TC-65: state file không tồn tại → not_found', async () => {
    useRoot()
    const res = await taskTools.getTaskState({ taskId: 'khong-co-task' })
    expect(codeOf(res)).toBe('not_found')
  })

  test('TC-66: state hỏng JSON → not_found kèm thông điệp đọc được', async () => {
    useRoot()
    const res = await taskTools.getTaskState({ taskId: 'task-d' })
    expect(codeOf(res)).toBe('not_found')
    expect(typeof res.content[0].text).toBe('string')
    expect(res.content[0].text.length).toBeGreaterThan(0)
  })

  test('TC-66b: state parse được nhưng không phải object → not_found', async () => {
    // "Parse được" ≠ "state hợp lệ". Chỉ chặn ở `try/catch` quanh `JSON.parse`
    // thì các ca này lọt xuống nhánh `ok` và client nhận `state` sai kiểu so
    // với `outputSchema` ⇒ `McpError` phía client.
    useRoot({ states: { 'task-g': '"chuoi"', 'task-arr': '[]', 'task-num': '42' } })
    for (const taskId of ['task-g', 'task-arr', 'task-num']) {
      const res = await taskTools.getTaskState({ taskId })
      expect(res.isError).toBe(true)
      expect(codeOf(res)).toBe('not_found')
      expect(res.structuredContent).toBeUndefined()
    }
  })

  test('TC-67: path-traversal qua taskId — dạng ../ (gọi thẳng handler ⇒ T2)', async () => {
    useRoot()
    for (const taskId of ['../../../etc/passwd', '..', '../secret', '.', '../..']) {
      const res = await taskTools.getTaskState({ taskId })
      expect(codeOf(res)).toBe('invalid_input')
      expect(JSON.stringify(res)).not.toContain(SECRET)
    }
  })

  test('TC-67b: cùng các giá trị đó qua tools/call — bị chặn ở T1, không lượt nào ok', async () => {
    useRoot()
    await withClient(async (client) => {
      for (const taskId of ['../../../etc/passwd', '..', '../secret', '../..']) {
        await expectT1(callRaw(client, 'get_task_state', { taskId }))
      }
    })
  })

  test('TC-68: path-traversal qua taskId — absolute và separator (T1 qua tools/call)', async () => {
    useRoot()
    // Cả bốn chuỗi đều chứa ký tự ngoài `TASK_ID_PATTERN` (`/`, `\`, `%`) ⇒ T1.
    await withClient(async (client) => {
      for (const taskId of ['/etc/passwd', 'a/b', 'a\\b', 'a%2f..%2fb']) {
        await expectT1(callRaw(client, 'get_task_state', { taskId }))
      }
    })
    // Đường thứ hai — gọi thẳng handler thì T1 không tồn tại, rơi xuống T2.
    for (const taskId of ['/etc/passwd', 'a/b', 'a\\b', 'a%2f..%2fb']) {
      const res = await taskTools.getTaskState({ taskId })
      expect(res.isError).toBe(true)
      expect(codeOf(res)).toBe('invalid_input')
      expect(JSON.stringify(res)).not.toContain(SECRET)
    }
  })

  test('TC-69: biên độ dài taskId', async () => {
    useRoot()
    await withClient(async (client) => {
      for (const len of [1, 200]) {
        const res: any = await callRaw(client, 'get_task_state', { taskId: 'a'.repeat(len) })
        // Qua được T1, tới handler, rồi trả not_found vì không có task đó.
        expect(res._meta?.error?.code).toBe('not_found')
      }
      for (const taskId of ['a'.repeat(201), '']) {
        await expectT1(callRaw(client, 'get_task_state', { taskId }))
      }
    })
  })

  test('TC-70: định dạng id thật đang dùng trong repo không bị chặn nhầm', async () => {
    useRoot()
    for (const taskId of ['20260927_001', 'Tb4241005', 'auto-0bdc9595', '202608_003']) {
      const res = await taskTools.getTaskState({ taskId })
      expect(codeOf(res)).not.toBe('invalid_input')
    }
  })

  test('TC-71: bắc cầu list_tasks → get_task_state (id server phát ra, server phải nhận lại)', async () => {
    useRoot()
    const ids = (await taskTools.listTasks({})).structuredContent.tasks.map((t: any) => t.id)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      const res = await taskTools.getTaskState({ taskId: id })
      expect(codeOf(res)).not.toBe('invalid_input')
    }
  })
})

// ── C.3 · list_artifacts ──────────────────────────────────────────────────────

describe('list_artifacts', () => {
  test('TC-72: artifact đã tạo và artifact known chưa tạo', async () => {
    useRoot()
    const res = await taskTools.listArtifacts({ taskId: 'task-a' })
    expect(res.isError).toBeUndefined()
    const { artifacts, subtasks } = res.structuredContent
    expect(artifacts['request.md']).toMatchObject({ exists: true })
    expect(typeof artifacts['request.md'].mtime).toBe('number')
    expect(artifacts['request.md'].size).toBeGreaterThan(0)
    // `review.md` do pipeline mặc định khai `produces` nhưng fixture chưa tạo.
    expect(artifacts['review.md']).toEqual({ exists: false, mtime: null, size: 0 })
    expect(subtasks).toContain('sub-1')
  })

  test('TC-73: size là số BYTE của file trên đĩa, mtime quanh lúc ghi', async () => {
    const before = Date.now()
    const root = useRoot()
    const content = '# Yêu cầu\nNội dung có dấu tiếng Việt\n'
    fs.writeFileSync(path.join(root, 'tasks', 'task-a', 'request.md'), content)
    const expectedBytes = Buffer.byteLength(content, 'utf8')
    expect(expectedBytes).toBeGreaterThan(content.length) // có dấu ⇒ byte > ký tự

    const { artifacts } = (await taskTools.listArtifacts({ taskId: 'task-a' })).structuredContent
    expect(artifacts['request.md'].size).toBe(expectedBytes)
    expect(artifacts['request.md'].mtime).toBeGreaterThanOrEqual(before - 5_000)
    expect(artifacts['request.md'].mtime).toBeLessThanOrEqual(Date.now() + 5_000)
  })

  test('TC-74: task không có thư mục artifact → ok, không entry nào exists', async () => {
    useRoot()
    const res = await taskTools.listArtifacts({ taskId: 'task-d' })
    expect(res.isError).toBeUndefined()
    const { artifacts, subtasks } = res.structuredContent
    expect(subtasks).toEqual([])
    for (const meta of Object.values<any>(artifacts)) expect(meta.exists).toBe(false)
  })

  test('TC-75: path-traversal qua taskId (gọi thẳng handler ⇒ T2)', async () => {
    const root = useRoot()
    for (const taskId of ['../..', '/etc', '../../tasks', '..']) {
      const res = await taskTools.listArtifacts({ taskId })
      expect(codeOf(res)).toBe('invalid_input')
      // Không liệt kê được nội dung thư mục nào ngoài `<root>/tasks/`.
      expect(JSON.stringify(res)).not.toContain('secret.txt')
      expect(JSON.stringify(res)).not.toContain(path.basename(root))
    }
  })

  test('TC-75b: cùng các giá trị đó qua tools/call — bị chặn ở T1', async () => {
    useRoot()
    await withClient(async (client) => {
      for (const taskId of ['../..', '/etc', '../../tasks']) {
        await expectT1(callRaw(client, 'list_artifacts', { taskId }))
      }
    })
  })

  test('TC-76: structuredContent và content[0].text không lệch nhau', async () => {
    useRoot()
    const results = [
      await taskTools.listTasks({}),
      await taskTools.getTaskState({ taskId: 'task-a' }),
      await taskTools.listArtifacts({ taskId: 'task-a' }),
    ]
    for (const res of results) {
      expect(res.structuredContent).toEqual(payload(res))
    }
  })
})

// ── C.4 · read_artifact ───────────────────────────────────────────────────────

describe('read_artifact', () => {
  test('TC-77: đọc đúng nguyên văn', async () => {
    const root = useRoot()
    const content = '# Yêu cầu\nNội dung có dấu tiếng Việt\n'
    fs.writeFileSync(path.join(root, 'tasks', 'task-a', 'request.md'), content)
    const res = await taskTools.readArtifact({ taskId: 'task-a', name: 'request.md' })
    expect(res.isError).toBeUndefined()
    const body = payload(res)
    expect(body.name).toBe('request.md')
    expect(body.content).toBe(content)
    expect(typeof body.mtime).toBe('number')
  })

  test('TC-78: read_artifact KHÔNG có structuredContent ở nhánh thành công', async () => {
    useRoot()
    const res = await taskTools.readArtifact({ taskId: 'task-a', name: 'request.md' })
    // Assert VẮNG MẶT, không phải `toBeUndefined()`: gán `undefined` cũng xanh.
    expect('structuredContent' in res).toBe(false)
  })

  test('TC-79: file không tồn tại → not_found, không ném', async () => {
    useRoot()
    const res = await taskTools.readArtifact({ taskId: 'task-a', name: 'khong-co.md' })
    expect(res.isError).toBe(true)
    expect(codeOf(res)).toBe('not_found')
  })

  test('TC-80: path-traversal qua name — và file ngoài root KHÔNG bị đọc', async () => {
    useRoot()
    for (const name of ['../../.dev-state/task-a.json', '../../secret.txt', '/etc/passwd', '..']) {
      const res = await taskTools.readArtifact({ taskId: 'task-a', name })
      expect(codeOf(res)).toBe('invalid_input')
      expect(res.content[0].text).toContain('escapes')
      // Assert phủ định trên NỘI DUNG thật — `invalid_input` một mình không
      // loại trừ việc đã đọc file rồi mới từ chối.
      expect(JSON.stringify(res)).not.toContain(SECRET)
    }
  })

  test('TC-81: path-traversal qua taskId dù name hợp lệ (T2 ở handler, T1 qua giao thức)', async () => {
    useRoot()
    const res = await taskTools.readArtifact({ taskId: '../.dev-state', name: 'task-a.json' })
    expect(codeOf(res)).toBe('invalid_input')
    expect(JSON.stringify(res)).not.toContain('current_phase')
    // Chặn `name` mà quên `taskId` vẫn thoát được thư mục — phủ cả hai tầng.
    await withClient(async (client) => {
      await expectT1(callRaw(client, 'read_artifact', { taskId: '../.dev-state', name: 'task-a.json' }))
    })
  })

  test('TC-82: name rỗng hoặc chứa byte null bị từ chối', async () => {
    useRoot()
    // Gọi thẳng handler: cả hai rơi xuống T2.
    expect(codeOf(await taskTools.readArtifact({ taskId: 'task-a', name: '' }))).toBe('invalid_input')
    expect(codeOf(await taskTools.readArtifact({ taskId: 'task-a', name: 'a\0b' }))).toBe('invalid_input')
    await withClient(async (client) => {
      // `name: ''` vi phạm `.min(1)` của schema ⇒ T1.
      await expectT1(callRaw(client, 'read_artifact', { taskId: 'task-a', name: '' }))
      // Byte null lọt qua schema ⇒ T2, handler tự chặn.
      const res: any = await callRaw(client, 'read_artifact', { taskId: 'task-a', name: 'a\0b' })
      expect(res.isError).toBe(true)
      expect(res._meta?.error?.code).toBe('invalid_input')
    })
  })

  test('TC-83: name trỏ thư mục → not_found (Q5), tuyệt đối không ok', async () => {
    useRoot()
    const res = await taskTools.readArtifact({ taskId: 'task-a', name: 'sub-1' })
    expect(res.isError).toBe(true)
    expect(codeOf(res)).toBe('not_found')
  })

  test('TC-84: tham số project chọn đúng root — cả 4 tool P2', async () => {
    // Hai project thật trong registry, cùng taskId, nội dung khác nhau.
    const mk = (marker: string) => {
      const base = mkTmp(`mcp-p${marker}-`)
      const ws = path.join(base, '.dev-team-agent')
      fs.mkdirSync(path.join(ws, '.dev-state'), { recursive: true })
      fs.mkdirSync(path.join(ws, 'tasks', 'task-a'), { recursive: true })
      fs.writeFileSync(
        path.join(ws, '.dev-state', 'task-a.json'),
        JSON.stringify({ task_id: 'task-a', name: `Task ${marker}`, current_phase: 'implementer' }),
      )
      fs.writeFileSync(path.join(ws, 'tasks', 'task-a', `only-${marker}.md`), `noi dung ${marker}\n`)
      return ws
    }
    const first = add({ path: mk('one'), name: 'p-one' })
    const second = add({ path: mk('two'), name: 'p-two' })
    expect('project' in first && 'project' in second).toBe(true)
    const secondId = (second as any).project.id
    // `first` là default — mọi lời gọi không truyền `project` sẽ trúng nó.
    expect((first as any).project.default).toBe(true)

    expect(
      (await taskTools.listTasks({ project: secondId })).structuredContent.tasks[0].name,
    ).toBe('Task two')
    expect(
      (await taskTools.getTaskState({ taskId: 'task-a', project: secondId })).structuredContent.state.name,
    ).toBe('Task two')
    expect(
      Object.keys((await taskTools.listArtifacts({ taskId: 'task-a', project: secondId })).structuredContent.artifacts),
    ).toContain('only-two.md')
    expect(
      payload(await taskTools.readArtifact({ taskId: 'task-a', name: 'only-two.md', project: secondId })).content,
    ).toBe('noi dung two\n')
    // Đối chứng: cùng tên file đó KHÔNG có ở project default.
    expect(codeOf(await taskTools.readArtifact({ taskId: 'task-a', name: 'only-two.md' }))).toBe('not_found')

    // Biến thể phủ định — `project` là id lạ: cùng hợp đồng lỗi với TC-62 trên
    // cả bốn tool, mã lỗi ở `_meta.error`.
    expect(codeOf(await taskTools.listTasks({ project: 'khong-co' }))).toBe('not_found')
    expect(codeOf(await taskTools.getTaskState({ taskId: 'task-a', project: 'khong-co' }))).toBe('not_found')
    expect(codeOf(await taskTools.listArtifacts({ taskId: 'task-a', project: 'khong-co' }))).toBe('not_found')
    expect(codeOf(await taskTools.readArtifact({ taskId: 'task-a', name: 'x.md', project: 'khong-co' }))).toBe('not_found')
  })
})

// ── Tbefa5f4c · Nhóm K (TC-K01 … TC-K21) — `get_task_context` ────────────────
//
// Tool này gom `cd <task-dir> && cat request.md && cat pipeline.yaml && ls -la`
// — chuỗi mở đầu của 21/25 phiên đo được — vào MỘT lời gọi. Giá trị nằm ở số
// vòng nó bỏ đi, nên hai thứ phải đúng: nhánh nào lỗi KHÔNG được khoá cả tool
// (TC-K05/K12), và `request` ⟂ `rules` phải CÙNG DẠNG (TC-K21).
describe('Nhóm K — TaskTools.getTaskContext', () => {
  const RULES = '# Rule của project\nKhông commit secret.\n'

  function contextRoot(): string {
    const root = makeRoot({
      states: {
        'task-a': { task_id: 'task-a', name: 'Task A', current_phase: 'implementer' },
        'task-d': '{ broken',
        'task-empty': { task_id: 'task-empty', name: 'Task rỗng', current_phase: 'investigator' },
      },
      tasks: {
        'task-a': {
          'request.md': '# Yêu cầu\nNội dung có dấu tiếng Việt\n',
          'design.md': '# Thiết kế\n',
        },
      },
      loose: {
        'secret.txt': SECRET,
        // `pipeline.yaml` ở GỐC root: `loadPipelineConfig` thay nguyên mảng
        // `steps` ở tầng này, nên danh sách step là xác định. Bản per-task thì
        // patch theo id vào `DEFAULT_PIPELINE`, không thay thế.
        'pipeline.yaml':
          'steps:\n'
          + '  - id: investigate\n'
          + '    name: Investigate\n'
          + '    agent: investigator\n'
          + '    produces: [investigate.md]\n'
          + '  - id: implementer\n'
          + '    name: Implement\n'
          + '    agent: implementer\n'
          + '    produces: [src]\n'
          + '  - id: reviewer\n'
          + '    name: Review\n'
          + '    agent: reviewer\n'
          + '    produces: [review.md]\n',
      },
    })
    process.env.DEV_TEAM_ROOT = root
    return root
  }

  test('TC-K01: 🔧 happy path — `request` là object {name, content, truncated}', async () => {
    contextRoot()
    const res = await taskTools.getTaskContext({ taskId: 'task-a' })
    expect(res.isError).toBeFalsy()
    const p = payload(res)

    expect(p.taskId).toBe('task-a')
    expect(p.task).toMatchObject({ id: 'task-a', name: 'Task A', phase: 'implementer' })

    // `request` KHÔNG còn là chuỗi.
    expect(typeof p.request).toBe('object')
    expect(typeof p.request.name).toBe('string')
    expect(p.request.content).toContain('Nội dung có dấu tiếng Việt')
    expect(p.request.truncated).toBe(false)

    expect(p.pipeline.steps.map((s: any) => s.id)).toEqual(['investigate', 'implementer', 'reviewer'])
    expect(p.pipeline.steps[0]).toMatchObject({ name: 'Investigate', agent: 'investigator' })
    expect(p.pipeline.steps[0].produces).toEqual(['investigate.md'])
    expect(p.pipeline.currentStepId).toBe('implementer')
    expect(p.pipeline.nextStepId).toBe('reviewer')

    expect(Object.keys(p.artifacts)).toContain('request.md')
    const artifact = p.artifacts['request.md']
    expect(artifact).toHaveProperty('mtime')
    expect(artifact).toHaveProperty('size')

    expect(p.state).toMatchObject({ task_id: 'task-a' })
    // `rules` tắt mặc định.
    expect(p.rules).toBeNull()
  })

  test('TC-K02: ⚠️ taskId thoát thư mục (E12) — và KHÔNG đọc file ngoài root', async () => {
    contextRoot()
    for (const taskId of ['../x', '../../etc', 'T1/../../y']) {
      const res = await taskTools.getTaskContext({ taskId })
      expect(codeOf(res)).toBe('invalid_input')
      expect(JSON.stringify(res)).not.toContain(SECRET)
    }
  })

  test('TC-K03: taskId sai định dạng khác', async () => {
    contextRoot()
    for (const taskId of ['', 'a b', 'T1%2f..']) {
      expect(codeOf(await taskTools.getTaskContext({ taskId }))).toBe('invalid_input')
    }
  })

  test('TC-K04: ⚠️ task chưa có artifact → ok, KHÔNG fail (E11)', async () => {
    contextRoot()
    const res = await taskTools.getTaskContext({ taskId: 'task-empty' })
    expect(res.isError).toBeFalsy()
    const p = payload(res)
    expect(p.request).toBeNull()
    expect(p.artifacts == null || Object.keys(p.artifacts).length === 0).toBe(true)
    expect(p.state).toMatchObject({ task_id: 'task-empty' })
  })

  test('TC-K05: ⚠️ `pipeline.yaml` hỏng (E13) → pipeline null, nhánh khác VẪN có dữ liệu', async () => {
    const root = makeRoot({
      states: { 'task-y': { task_id: 'task-y', name: 'Task Y', current_phase: 'implementer' } },
      tasks: { 'task-y': { 'request.md': '# Y\n' } },
      loose: { 'pipeline.yaml': 'steps: [ - id: a\n  bad: : :\n' },
    })
    process.env.DEV_TEAM_ROOT = root

    const res = await taskTools.getTaskContext({ taskId: 'task-y' })
    expect(res.isError).toBeFalsy()
    const p = payload(res)
    expect(p.pipeline).toBeNull()
    expect(p.request.content).toContain('# Y')
    expect(p.state).toMatchObject({ task_id: 'task-y' })
    expect(Object.keys(p.artifacts)).toContain('request.md')
  })

  test('TC-K06: `rules` mặc định TẮT, các nhánh mặc định khác đều có', async () => {
    const root = contextRoot()
    fs.writeFileSync(path.join(root, 'project-rules.md'), RULES)

    const p = payload(await taskTools.getTaskContext({ taskId: 'task-a' }))
    expect(p.rules).toBeNull()
    expect(p.request).not.toBeNull()
    expect(p.pipeline).not.toBeNull()
    expect(p.artifacts).not.toBeNull()
    expect(p.state).not.toBeNull()
  })

  test('TC-K07: 🔧 `include: [rules]` trả object {name, content, truncated}', async () => {
    const root = contextRoot()
    fs.writeFileSync(path.join(root, 'project-rules.md'), RULES)

    const p = payload(await taskTools.getTaskContext({ taskId: 'task-a', include: ['rules'] }))
    expect(typeof p.rules).toBe('object')
    expect(typeof p.rules).not.toBe('string')
    expect(p.rules.name).toBe('project-rules.md')
    expect(p.rules.content).toBe(RULES)
    expect(p.rules.truncated).toBe(false)
  })

  test('TC-K08: `include` thu hẹp đúng', async () => {
    contextRoot()
    const p = payload(await taskTools.getTaskContext({ taskId: 'task-a', include: ['request'] }))
    expect(p.request).not.toBeNull()
    expect(p.state).toBeNull()
    expect(p.artifacts).toBeNull()
    expect(p.pipeline).toBeNull()
    expect(p.rules).toBeNull()
  })

  test('TC-K09: `include` giá trị lạ → invalid_input', async () => {
    contextRoot()
    expect(codeOf(await taskTools.getTaskContext({ taskId: 'task-a', include: ['bogus'] }))).toBe(
      'invalid_input',
    )
    // Và enum ở schema chặn ngay tầng validate input của SDK.
    await withClient(async (client) => {
      const res = await callRaw(client, 'get_task_context', { taskId: 'task-a', include: ['bogus'] })
      expect(res.isError).toBe(true)
    })
  })

  test('TC-K10: `project-rules.md` không tồn tại → ok, rules null (không fail)', async () => {
    contextRoot()
    const res = await taskTools.getTaskContext({ taskId: 'task-a', include: ['rules'] })
    expect(res.isError).toBeFalsy()
    expect(payload(res).rules).toBeNull()
  })

  test('TC-K11: project không tồn tại → fail, không throw', async () => {
    contextRoot()
    const res = await taskTools.getTaskContext({ taskId: 'task-a', project: 'khong-co' })
    expect(codeOf(res)).toBe('not_found')
  })

  test('TC-K12: một nhánh lỗi KHÔNG khoá cả tool', async () => {
    // `.dev-state/task-d.json` là JSON hỏng ⇒ nhánh `state` không đọc được.
    const root = contextRoot()
    fs.mkdirSync(path.join(root, 'tasks', 'task-d'), { recursive: true })
    fs.writeFileSync(path.join(root, 'tasks', 'task-d', 'request.md'), '# D\n')

    const res = await taskTools.getTaskContext({ taskId: 'task-d' })
    expect(res.isError).toBeFalsy()
    const p = payload(res)
    expect(p.state).toBeNull()
    expect(p.task).toBeNull()
    expect(p.request.content).toContain('# D')
    expect(Object.keys(p.artifacts)).toContain('request.md')
  })

  test('TC-K13: 🔧 vượt trần 64 KiB — CÙNG một ngưỡng cho cả `request` lẫn `rules`', async () => {
    const root = contextRoot()
    const big = 'x'.repeat(70 * 1024)
    fs.writeFileSync(path.join(root, 'tasks', 'task-a', 'request.md'), big)
    fs.writeFileSync(path.join(root, 'project-rules.md'), big)

    const p = payload(await taskTools.getTaskContext({ taskId: 'task-a', include: ['request', 'rules'] }))
    for (const branch of [p.request, p.rules]) {
      expect(branch.truncated).toBe(true)
      expect(branch.content.length).toBe(64 * 1024)
      expect(typeof branch.name).toBe('string')
      expect(branch.name.length).toBeGreaterThan(0)
    }

    // File nhỏ → truncated false ở cả hai nhánh.
    fs.writeFileSync(path.join(root, 'tasks', 'task-a', 'request.md'), '# nhỏ\n')
    fs.writeFileSync(path.join(root, 'project-rules.md'), RULES)
    const small = payload(await taskTools.getTaskContext({ taskId: 'task-a', include: ['request', 'rules'] }))
    expect(small.request.truncated).toBe(false)
    expect(small.rules.truncated).toBe(false)
  })

  test('TC-K14: trả `structured: false` — payload nằm trong content text JSON', async () => {
    contextRoot()
    const res = await taskTools.getTaskContext({ taskId: 'task-a' })
    expect(res.structuredContent).toBeUndefined()
    expect(typeof res.content[0].text).toBe('string')
    expect(JSON.parse(res.content[0].text).taskId).toBe('task-a')

    const tools = await withClient(async (client) => (await client.listTools()).tools)
    expect('outputSchema' in tools.find((t: any) => t.name === 'get_task_context')!).toBe(false)
  })

  test('TC-K15: ⚠️ có mặt ở CẢ HAI mode', async () => {
    contextRoot()
    for (const mode of ['readonly', 'full'] as const) {
      const names = await withClient(
        async (client) => (await client.listTools()).tools.map((t: any) => t.name),
        mode,
      )
      expect(names).toContain('get_task_context')
    }
  })

  test('TC-K17 + TC-K18 + TC-K20: annotation, inputSchema và description', async () => {
    contextRoot()
    const tool = await withClient(
      async (client) => (await client.listTools()).tools.find((t: any) => t.name === 'get_task_context'),
      'readonly',
    )
    expect(tool.annotations?.readOnlyHint).toBe(true)
    expect(tool.annotations?.openWorldHint).toBe(false)

    const schema = tool.inputSchema as any
    expect(schema.required).toEqual(['taskId'])
    expect(Object.keys(schema.properties).sort()).toEqual(['include', 'project', 'taskId'])
    expect(schema.properties.include.items.enum).toEqual([
      'request',
      'pipeline',
      'artifacts',
      'state',
      'rules',
    ])

    // D1: mô tả PHẢI nói nó thay cho chuỗi nào — 10 tool MCP từng ship với 0 lượt
    // gọi vì không có gì nói cho agent biết chúng thay được cái gì.
    expect(tool.description).toBeTruthy()
    expect(tool.description).toContain('request.md')
    expect(tool.description).toContain('cd ')
    expect(tool.description).toContain('cat ')
    expect(tool.description).toContain('ls ')
  })

  test('TC-K21: 🆕 ⚠️ `rules` đối xứng `request` ở MỌI nhánh', async () => {
    const root = contextRoot()
    const CONTRACT = ['content', 'name', 'truncated']

    // (1) có file.
    fs.writeFileSync(path.join(root, 'project-rules.md'), RULES)
    const withFile = payload(await taskTools.getTaskContext({ taskId: 'task-a', include: ['request', 'rules'] }))
    expect(Object.keys(withFile.rules).sort()).toEqual(CONTRACT)
    // `request` mang thêm `mtime` (xem test-result.md › Lệch spec) nhưng ba khoá
    // hợp đồng phải CÙNG kiểu ở hai nhánh.
    for (const key of CONTRACT) {
      expect(typeof withFile.request[key]).toBe(typeof withFile.rules[key])
    }

    // (2) không có file → null ở cả hai nhánh, KHÔNG phải `{content: null}`, không fail.
    fs.unlinkSync(path.join(root, 'project-rules.md'))
    fs.unlinkSync(path.join(root, 'tasks', 'task-a', 'request.md'))
    const missing = await taskTools.getTaskContext({ taskId: 'task-a', include: ['request', 'rules'] })
    expect(missing.isError).toBeFalsy()
    expect(payload(missing).rules).toBeNull()
    expect(payload(missing).request).toBeNull()

    // (3) file rỗng → content '' và truncated false ở cả hai nhánh.
    fs.writeFileSync(path.join(root, 'project-rules.md'), '')
    fs.writeFileSync(path.join(root, 'tasks', 'task-a', 'request.md'), '')
    const empty = payload(await taskTools.getTaskContext({ taskId: 'task-a', include: ['request', 'rules'] }))
    expect(empty.rules.content).toBe('')
    expect(empty.rules.truncated).toBe(false)
    expect(empty.request.content).toBe('')
    expect(empty.request.truncated).toBe(false)
  })
})
