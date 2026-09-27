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
import {
  createMcpServer,
  handleGetTaskState,
  handleListArtifacts,
  handleListTasks,
  handleReadArtifact,
} from '../../mcp/server'

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
const codeOf = (r: any) => r.structuredContent?.error?.code

/** Client MCP in-memory — cần khi muốn quan sát TẦNG VALIDATE INPUT. */
async function withClient<T>(fn: (client: Client) => Promise<T>, mode: 'readonly' | 'full' = 'full'): Promise<T> {
  const server = createMcpServer({ mode })
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

/**
 * Gọi tool qua giao thức mà KHÔNG nạp validator output phía client (không
 * `listTools`), để kết quả nhánh lỗi đi ra dưới dạng `CallToolResult` thay vì
 * bị `Client.callTool` ném — xem test-result.md › Bug phát hiện ở source.
 */
async function callRaw(client: Client, name: string, args: Record<string, unknown>): Promise<any> {
  return client.callTool({ name, arguments: args })
}

/** Lời gọi bị chặn ở tầng validate input: có `isError`, KHÔNG có `structuredContent`. */
function expectRejectedByValidation(res: any) {
  expect(res.isError).toBe(true)
  // Handler chưa chạy ⇒ không có envelope `fail(code, …)` nào được dựng.
  expect('structuredContent' in res).toBe(false)
}

// ── C.1 · list_tasks ──────────────────────────────────────────────────────────

describe('list_tasks', () => {
  test('TC-49: liệt kê mặc định — đúng bộ khoá, có total', async () => {
    useRoot()
    const res = await handleListTasks({})
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
    const ids = (await handleListTasks({ status: 'waiting' })).structuredContent.tasks.map((t: any) => t.id)
    expect(ids).toContain('task-c')
    expect(ids).not.toContain('task-a')
    expect(ids).not.toContain('task-b')
  })

  test("TC-51: status 'completed'", async () => {
    useRoot()
    const ids = (await handleListTasks({ status: 'completed' })).structuredContent.tasks.map((t: any) => t.id)
    expect(ids).toContain('task-b')
    expect(ids).not.toContain('task-a')
    expect(ids).not.toContain('task-c')
  })

  test("TC-52: status 'running' — phần còn lại", async () => {
    useRoot()
    const ids = (await handleListTasks({ status: 'running' })).structuredContent.tasks.map((t: any) => t.id)
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
    const all = (await handleListTasks({})).structuredContent.tasks
    expect(all.find((t: any) => t.id === 'task-f').hitlPending).toBeNull()

    const idsIn = async (status: 'running' | 'waiting' | 'completed') =>
      (await handleListTasks({ status })).structuredContent.tasks.map((t: any) => t.id)
    expect(await idsIn('completed')).toContain('task-f')
    expect(await idsIn('waiting')).not.toContain('task-f')
    expect(await idsIn('running')).not.toContain('task-f')
  })

  test('TC-54: ba nhánh status rời nhau và phủ kín', async () => {
    useRoot()
    const all = (await handleListTasks({})).structuredContent.tasks.map((t: any) => t.id)
    const buckets = await Promise.all(
      (['running', 'waiting', 'completed'] as const).map(async (status) =>
        (await handleListTasks({ status })).structuredContent.tasks.map((t: any) => t.id),
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

    const tasks = (await handleListTasks({})).structuredContent.tasks
    const times = tasks.map((t: any) => t.updatedAt)
    const nonNull = times.filter((v: number | null) => v !== null)
    expect(nonNull).toEqual([...nonNull].sort((a: number, b: number) => b - a))
    expect(times.slice(nonNull.length).every((v: number | null) => v === null)).toBe(true)
    expect(tasks[tasks.length - 1].id).toBe('task-nostate')
  })

  test('TC-56: limit cắt danh sách nhưng KHÔNG đổi total', async () => {
    useRoot()
    const res = await handleListTasks({ limit: 2 })
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
    const res = await handleListTasks({ status: 'waiting', limit: 1 })
    expect(res.structuredContent.tasks).toHaveLength(1)
    // Không phải 5 (chưa lọc), cũng không phải 1 (đã cắt).
    expect(res.structuredContent.total).toBe(3)
  })

  test('TC-58: limit lớn hơn số task', async () => {
    useRoot()
    const res = await handleListTasks({ limit: 200 })
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
        expectRejectedByValidation(await callRaw(client, 'list_tasks', { limit }))
      }
    })
  })

  test('TC-60: root rỗng hoàn toàn → { tasks: [], total: 0 }, không ném', async () => {
    useRoot({})
    const res = await handleListTasks({})
    expect(res.isError).toBeUndefined()
    expect(res.structuredContent).toEqual({ tasks: [], total: 0 })
  })

  test('TC-61: state hỏng JSON vẫn được liệt kê, phase null', async () => {
    useRoot()
    const res = await handleListTasks({})
    expect(res.isError).toBeUndefined()
    const broken = res.structuredContent.tasks.find((t: any) => t.id === 'task-d')
    expect(broken).toBeTruthy()
    expect(broken.phase).toBeNull()
  })

  test('TC-62: project không tồn tại → not_found, text nhắc tên project', async () => {
    useRoot()
    const res = await handleListTasks({ project: 'khong-co' })
    expect(res.isError).toBe(true)
    expect(codeOf(res)).toBe('not_found')
    expect(res.content[0].text).toContain('khong-co')
  })

  test('TC-63: không có default project → not_found, thông điệp tự-phục-hồi', async () => {
    // Registry rỗng (`DEV_TEAM_DASHBOARD_HOME` là thư mục tạm trống) và
    // `DEV_TEAM_ROOT` không đặt. Chốt luôn: KHÔNG có fallback ngầm sang cwd,
    // kể cả khi cwd của tiến trình test là một dev-team root thật.
    delete process.env.DEV_TEAM_ROOT
    const res = await handleListTasks({})
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
    const res = await handleGetTaskState({ taskId: 'task-a' })
    expect(res.isError).toBeUndefined()
    expect(res.structuredContent.state).toEqual({
      task_id: 'task-a',
      name: 'Task A',
      current_phase: 'implementer',
    })
  })

  test('TC-65: state file không tồn tại → not_found', async () => {
    useRoot()
    const res = await handleGetTaskState({ taskId: 'khong-co-task' })
    expect(codeOf(res)).toBe('not_found')
  })

  test('TC-66: state hỏng JSON → not_found kèm thông điệp đọc được', async () => {
    useRoot()
    const res = await handleGetTaskState({ taskId: 'task-d' })
    expect(codeOf(res)).toBe('not_found')
    expect(typeof res.content[0].text).toBe('string')
    expect(res.content[0].text.length).toBeGreaterThan(0)
  })

  test('TC-66b: state parse ra không phải object → not_found, không để SDK ném', async () => {
    useRoot({ states: { 'task-arr': '[1,2,3]' } })
    const res = await handleGetTaskState({ taskId: 'task-arr' })
    expect(codeOf(res)).toBe('not_found')
  })

  test('TC-67: path-traversal qua taskId — dạng ../', async () => {
    useRoot()
    for (const taskId of ['../../../etc/passwd', '..', '../secret', '.', '../..']) {
      const res = await handleGetTaskState({ taskId })
      expect(codeOf(res)).toBe('invalid_input')
      expect(JSON.stringify(res)).not.toContain(SECRET)
    }
  })

  test('TC-68: path-traversal qua taskId — absolute và separator', async () => {
    useRoot()
    for (const taskId of ['/etc/passwd', 'a/b', 'a\\b', 'a%2f..%2fb']) {
      const res = await handleGetTaskState({ taskId })
      expect(res.isError).toBe(true)
      expect(codeOf(res)).toBe('invalid_input')
    }
    // Cùng các giá trị đó qua giao thức: bị chặn sớm hơn, ở tầng validate input.
    await withClient(async (client) => {
      for (const taskId of ['/etc/passwd', 'a/b', 'a\\b', '..']) {
        expectRejectedByValidation(await callRaw(client, 'get_task_state', { taskId }))
      }
    })
  })

  test('TC-69: biên độ dài taskId', async () => {
    useRoot()
    await withClient(async (client) => {
      for (const len of [1, 200]) {
        const res: any = await callRaw(client, 'get_task_state', { taskId: 'a'.repeat(len) })
        // Qua được validate, rồi trả not_found vì không có task đó.
        expect(res.structuredContent?.error?.code).toBe('not_found')
      }
      for (const taskId of ['a'.repeat(201), '']) {
        expectRejectedByValidation(await callRaw(client, 'get_task_state', { taskId }))
      }
    })
  })

  test('TC-70: định dạng id thật đang dùng trong repo không bị chặn nhầm', async () => {
    useRoot()
    for (const taskId of ['20260927_001', 'Tb4241005', 'auto-0bdc9595', '202608_003']) {
      const res = await handleGetTaskState({ taskId })
      expect(codeOf(res)).not.toBe('invalid_input')
    }
  })

  test('TC-71: bắc cầu list_tasks → get_task_state (id server phát ra, server phải nhận lại)', async () => {
    useRoot()
    const ids = (await handleListTasks({})).structuredContent.tasks.map((t: any) => t.id)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      const res = await handleGetTaskState({ taskId: id })
      expect(codeOf(res)).not.toBe('invalid_input')
    }
  })
})

// ── C.3 · list_artifacts ──────────────────────────────────────────────────────

describe('list_artifacts', () => {
  test('TC-72: artifact đã tạo và artifact known chưa tạo', async () => {
    useRoot()
    const res = await handleListArtifacts({ taskId: 'task-a' })
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

    const { artifacts } = (await handleListArtifacts({ taskId: 'task-a' })).structuredContent
    expect(artifacts['request.md'].size).toBe(expectedBytes)
    expect(artifacts['request.md'].mtime).toBeGreaterThanOrEqual(before - 5_000)
    expect(artifacts['request.md'].mtime).toBeLessThanOrEqual(Date.now() + 5_000)
  })

  test('TC-74: task không có thư mục artifact → ok, không entry nào exists', async () => {
    useRoot()
    const res = await handleListArtifacts({ taskId: 'task-d' })
    expect(res.isError).toBeUndefined()
    const { artifacts, subtasks } = res.structuredContent
    expect(subtasks).toEqual([])
    for (const meta of Object.values<any>(artifacts)) expect(meta.exists).toBe(false)
  })

  test('TC-75: path-traversal qua taskId', async () => {
    const root = useRoot()
    for (const taskId of ['../..', '/etc', '../../tasks', '..']) {
      const res = await handleListArtifacts({ taskId })
      expect(codeOf(res)).toBe('invalid_input')
      // Không liệt kê được nội dung thư mục nào ngoài `<root>/tasks/`.
      expect(JSON.stringify(res)).not.toContain('secret.txt')
      expect(JSON.stringify(res)).not.toContain(path.basename(root))
    }
  })

  test('TC-76: structuredContent và content[0].text không lệch nhau', async () => {
    useRoot()
    const results = [
      await handleListTasks({}),
      await handleGetTaskState({ taskId: 'task-a' }),
      await handleListArtifacts({ taskId: 'task-a' }),
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
    const res = await handleReadArtifact({ taskId: 'task-a', name: 'request.md' })
    expect(res.isError).toBeUndefined()
    const body = payload(res)
    expect(body.name).toBe('request.md')
    expect(body.content).toBe(content)
    expect(typeof body.mtime).toBe('number')
  })

  test('TC-78: read_artifact KHÔNG có structuredContent ở nhánh thành công', async () => {
    useRoot()
    const res = await handleReadArtifact({ taskId: 'task-a', name: 'request.md' })
    // Assert VẮNG MẶT, không phải `toBeUndefined()`: gán `undefined` cũng xanh.
    expect('structuredContent' in res).toBe(false)
  })

  test('TC-79: file không tồn tại → not_found, không ném', async () => {
    useRoot()
    const res = await handleReadArtifact({ taskId: 'task-a', name: 'khong-co.md' })
    expect(res.isError).toBe(true)
    expect(codeOf(res)).toBe('not_found')
  })

  test('TC-80: path-traversal qua name — và file ngoài root KHÔNG bị đọc', async () => {
    useRoot()
    for (const name of ['../../.dev-state/task-a.json', '../../secret.txt', '/etc/passwd', '..']) {
      const res = await handleReadArtifact({ taskId: 'task-a', name })
      expect(codeOf(res)).toBe('invalid_input')
      expect(res.content[0].text).toContain('escapes')
      // Assert phủ định trên NỘI DUNG thật — `invalid_input` một mình không
      // loại trừ việc đã đọc file rồi mới từ chối.
      expect(JSON.stringify(res)).not.toContain(SECRET)
    }
  })

  test('TC-81: path-traversal qua taskId dù name hợp lệ', async () => {
    useRoot()
    const res = await handleReadArtifact({ taskId: '../.dev-state', name: 'task-a.json' })
    expect(codeOf(res)).toBe('invalid_input')
    expect(JSON.stringify(res)).not.toContain('current_phase')
  })

  test('TC-82: name rỗng hoặc chứa byte null bị từ chối', async () => {
    useRoot()
    expect(codeOf(await handleReadArtifact({ taskId: 'task-a', name: '' }))).toBe('invalid_input')
    expect(codeOf(await handleReadArtifact({ taskId: 'task-a', name: 'a\0b' }))).toBe('invalid_input')
    await withClient(async (client) => {
      expectRejectedByValidation(await callRaw(client, 'read_artifact', { taskId: 'task-a', name: '' }))
      const res: any = await callRaw(client, 'read_artifact', { taskId: 'task-a', name: 'a\0b' })
      expect(res.isError).toBe(true)
    })
  })

  test('TC-83: name trỏ thư mục → not_found (Q5), tuyệt đối không ok', async () => {
    useRoot()
    const res = await handleReadArtifact({ taskId: 'task-a', name: 'sub-1' })
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
      (await handleListTasks({ project: secondId })).structuredContent.tasks[0].name,
    ).toBe('Task two')
    expect(
      (await handleGetTaskState({ taskId: 'task-a', project: secondId })).structuredContent.state.name,
    ).toBe('Task two')
    expect(
      Object.keys((await handleListArtifacts({ taskId: 'task-a', project: secondId })).structuredContent.artifacts),
    ).toContain('only-two.md')
    expect(
      payload(await handleReadArtifact({ taskId: 'task-a', name: 'only-two.md', project: secondId })).content,
    ).toBe('noi dung two\n')
    // Đối chứng: cùng tên file đó KHÔNG có ở project default.
    expect(codeOf(await handleReadArtifact({ taskId: 'task-a', name: 'only-two.md' }))).toBe('not_found')
  })
})
