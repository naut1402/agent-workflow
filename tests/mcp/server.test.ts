// Tb4241005 · TC-01 … TC-30 + TC-88 … TC-92 — MCP server (vai inbound).
//
// 6 case gốc của 1.1.x được GIỮ NGUYÊN làm mốc không-hồi-quy; chỉ case
// "createMcpServer dựng được" được mở rộng thành TC-15 (assert nội dung
// `tools/list` thay vì chỉ "dựng được").

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { on } from '../../src/backend/events/index.js'
import { resetLogDriver, setLogDriver } from '../../src/backend/log/index.js'
import { invalidateLoggingPrefsCache } from '../../src/backend/log/loggingPrefsIo.js'
import { MAX_BUNDLE_IDS } from '../../src/features/knowledge/schemas/knowledge.js'
import {
  createMcpServer,
  fail,
  handleAddProject,
  handleGetKnowledgeBundle,
  handleGetProject,
  handleListProjects,
  handleRemoveProject,
  ok,
} from '../../mcp/server'

let home: string
let proj: string
const saved: Record<string, string | undefined> = {}

// §1.4: BỐN biến, không chỉ hai. `DEVTEAM_MCP_MODE` của máy dev rò vào test sẽ
// làm case "mặc định readonly" (TC-15) đỏ giả.
const ISOLATED = [
  'DEV_TEAM_DASHBOARD_HOME',
  'DEV_TEAM_ROOT',
  'DEVTEAM_MCP_MODE',
  'DEVTEAM_MCP_PROJECT',
] as const

beforeEach(() => {
  for (const key of ISOLATED) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-home-'))
  proj = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-proj-'))
  fs.mkdirSync(path.join(proj, '.dev-team-agent'), { recursive: true })
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  invalidateLoggingPrefsCache()
})
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(proj, { recursive: true, force: true })
  for (const key of ISOLATED) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  resetLogDriver()
  invalidateLoggingPrefsCache()
})

const payload = (r: any) => JSON.parse(r.content[0].text)
// Hợp đồng lỗi (bản vá B1, commit 900d78d): mã lỗi ở `_meta.error`, KHÔNG phải
// `structuredContent.error` — khoá `structuredContent` ở nhánh lỗi là đúng cái
// làm validator phía client ném `McpError -32602` (§5.1 của test-spec).
const codeOf = (r: any) => r._meta?.error?.code

const REPO_ROOT = path.resolve(import.meta.dir, '..', '..')

/** Workspace `.dev-team-agent` của project tạm — dùng làm `DEV_TEAM_ROOT`. */
function workspace(): string {
  return path.join(proj, '.dev-team-agent')
}

function writeKnowledge(id: string, title: string, body: string) {
  const [scope, slug] = id.split('/')
  const dir = path.join(workspace(), 'knowledge', scope)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${slug}.md`),
    `---\ntitle: ${title}\nscope: ${scope}\n---\n\n${body}\n`,
  )
}

// ═══ 6 case gốc — mốc không-hồi-quy, KHÔNG sửa assert ═════════════════════════

describe('ok / fail envelopes', () => {
  test('ok wraps JSON text content', () => {
    expect(payload(ok({ a: 1 }))).toEqual({ a: 1 })
  })
  test('fail sets isError + message', () => {
    const r = fail('boom')
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toBe('boom')
  })
})

describe('tool handlers over a temp registry', () => {
  test('add → list → get → remove flow', () => {
    const added = handleAddProject({ path: proj })
    const project = payload(added).project
    expect(project.default).toBe(true)

    expect(payload(handleListProjects()).projects).toHaveLength(1)
    expect(payload(handleGetProject({ id: project.id })).project.id).toBe(project.id)

    // removing the (only, default) project succeeds, leaving an empty registry
    const rm = handleRemoveProject({ id: project.id })
    expect(rm.isError).toBeUndefined()
    expect(payload(handleListProjects()).projects).toHaveLength(0)
  })

  test('get unknown id → fail', () => {
    expect(handleGetProject({ id: 'nope' }).isError).toBe(true)
  })

  test('add invalid path → fail', () => {
    expect(handleAddProject({ path: 'relative/x' }).isError).toBe(true)
  })

  // TC-07: kênh MCP dùng chung `registry.add()` với kênh UI (đã test trực tiếp ở
  // registry.test.ts) — add qua MCP cũng phải scaffold pipeline.yaml, không
  // phụ thuộc phpstan.md, để hai kênh cho kết quả nhất quán.
  test('add qua MCP scaffold pipeline.yaml, không tham chiếu phpstan.md (TC-07)', () => {
    const dest = path.join(proj, '.dev-team-agent', 'pipeline.yaml')
    expect(fs.existsSync(dest)).toBe(false)
    handleAddProject({ path: proj })
    expect(fs.existsSync(dest)).toBe(true)
    const content = fs.readFileSync(dest, 'utf8')
    expect(content).not.toContain('phpstan.md')
    expect(content).toContain('investigate.md')
  })
})

// ═══ Nhóm A · envelope ok / fail (TC-01 … TC-06) ══════════════════════════════

describe('envelope ok / fail — hợp đồng cũ và mới song song (D6/D14)', () => {
  test('TC-01: ok phát song song text và structured', () => {
    const value = { a: 1, b: ['x'] }
    const res = ok(value)
    expect(res.content).toEqual([{ type: 'text', text: JSON.stringify(value, null, 2) }])
    expect(res.structuredContent).toEqual(value)
    expect('isError' in res).toBe(false)
  })

  test('TC-02: ok(..., { structured: false }) bỏ hẳn KHOÁ structuredContent', () => {
    const res = ok({ big: 'x' }, { structured: false })
    expect(res.content).toEqual([{ type: 'text', text: JSON.stringify({ big: 'x' }, null, 2) }])
    // Assert VẮNG MẶT: `toBeUndefined()` xanh giả nếu gán `structuredContent: undefined`.
    expect('structuredContent' in res).toBe(false)
  })

  test('TC-03: fail(message) một-tham-số — hình dạng không đổi một byte', () => {
    expect(fail('boom')).toEqual({ isError: true, content: [{ type: 'text', text: 'boom' }] })
    const err = new Error('boom')
    expect(fail(err)).toEqual({ isError: true, content: [{ type: 'text', text: String(err) }] })
    expect('structuredContent' in fail('boom')).toBe(false)
  })

  test('TC-04: fail(code, message) giữ nguyên text, thêm mã máy đọc ở _meta', () => {
    const res = fail('not_found', 'unknown project: zzz')
    // Vế 1 — tương thích ngược (D14): client 1.1.x đọc `content[0].text` phải
    // thấy đúng chuỗi cũ. KHÔNG tiền tố `not_found:` (chọn D1', không phải D2').
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('unknown project: zzz')
    // Vế 2 — mã máy đọc (AC-07/L10). Deep-equal cả object để bắt cả ca thiếu
    // `message` lẫn ca thừa khoá.
    expect(res._meta.error).toEqual({
      code: 'not_found',
      message: 'unknown project: zzz',
    })
  })

  test('TC-04b: nhánh lỗi hai-tham-số KHÔNG có khoá structuredContent', () => {
    // Assert quan trọng nhất của nhóm envelope. Chính sự CÓ MẶT của khoá này ở
    // nhánh lỗi làm `client/index.js:508` ném `McpError -32602` (hồi quy B1).
    for (const res of [fail('not_found', 'unknown project: zzz'), fail('invalid_input', 'bad path')]) {
      expect('structuredContent' in res).toBe(false)
    }
  })

  test('TC-05: bốn mã lỗi đi nguyên vẹn', () => {
    for (const code of ['not_found', 'invalid_input', 'forbidden_in_mode', 'internal'] as const) {
      const res = fail(code, 'x')
      expect(res._meta.error.code).toBe(code)
      expect('structuredContent' in res).toBe(false)
    }
  })

  test('TC-06: message không phải chuỗi; biên overload nằm ở SỐ THAM SỐ', () => {
    expect(fail('internal', { nested: true }).content[0].text).toBe(String({ nested: true }))
    // Một tham số `undefined` → vẫn là overload MỘT tham số.
    const one = fail(undefined)
    expect(one.content[0].text).toBe('undefined')
    expect('structuredContent' in one).toBe(false)
    expect('_meta' in one).toBe(false)
    // Hai tham số với tham số thứ hai `undefined` → overload HAI tham số (Q1).
    const two = fail('internal', undefined)
    expect(two.content[0].text).toBe('undefined')
    expect(two._meta.error).toEqual({ code: 'internal', message: 'undefined' })
    expect('structuredContent' in two).toBe(false)
  })
})

// ═══ Nhóm A · handleGetKnowledgeBundle (TC-07 … TC-14) ════════════════════════

describe('get_knowledge_bundle', () => {
  beforeEach(() => {
    process.env.DEV_TEAM_ROOT = workspace()
    writeKnowledge('project/k1', 'K một', 'noi dung k1')
    writeKnowledge('project/k2', 'K hai', 'noi dung k2')
  })

  test('TC-07: bundle hợp lệ mang đúng nội dung từng entry', async () => {
    const res = await handleGetKnowledgeBundle({ ids: ['project/k1', 'project/k2'] })
    expect(res.isError).toBeUndefined()
    const bundle = payload(res).bundle
    expect(bundle).toHaveLength(2)
    expect(bundle[0].content).toContain('noi dung k1')
    expect(bundle[1].content).toContain('noi dung k2')
  })

  test('TC-08: get_knowledge_bundle KHÔNG có structuredContent (G8)', async () => {
    const res = await handleGetKnowledgeBundle({ ids: ['project/k1'] })
    expect('structuredContent' in res).toBe(false)
  })

  test('TC-09: id lạ là lỗi TỪNG PHẦN TỬ, không hỏng cả lượt gọi', async () => {
    const res = await handleGetKnowledgeBundle({ ids: ['project/k1', 'project/khong-ton-tai'] })
    expect(res.isError).toBeFalsy()
    const bundle = payload(res).bundle
    expect(bundle[0].content).toContain('noi dung k1')
    expect(bundle[1].id).toBe('project/khong-ton-tai')
    expect(typeof bundle[1].error).toBe('string')
  })

  test('TC-10: mọi id đều lạ — vẫn không phải lỗi cả lượt', async () => {
    const res = await handleGetKnowledgeBundle({ ids: ['project/x', 'project/y'] })
    expect(res.isError).toBeFalsy()
    for (const entry of payload(res).bundle) {
      expect(typeof entry.id).toBe('string')
      expect(typeof entry.error).toBe('string')
    }
  })

  test('TC-11: project không tồn tại → not_found', async () => {
    const res = await handleGetKnowledgeBundle({ ids: ['project/k1'], project: 'khong-co-project-nay' })
    expect(res.isError).toBe(true)
    expect(codeOf(res)).toBe('not_found')
    expect(res.content[0].text).toContain('khong-co-project-nay')
  })

  test('TC-12: ngay tại trần MAX_BUNDLE_IDS — được chấp nhận', async () => {
    // Đọc hằng từ feature knowledge, KHÔNG gõ số 50: gõ số là tái tạo L12 ở
    // phía test (đổi hằng thì trần tool đổi mà test vẫn xanh).
    const ids = Array.from({ length: MAX_BUNDLE_IDS }, (_, i) => `project/k${i}`)
    await withInMemoryClient(async (client) => {
      const res: any = await client.callTool({ name: 'get_knowledge_bundle', arguments: { ids } })
      expect(res.isError).toBeFalsy()
    })
  })

  test('TC-13: vượt trần một phần tử — bị chặn ở tầng validate, handler không chạy', async () => {
    const ids = Array.from({ length: MAX_BUNDLE_IDS + 1 }, (_, i) => `project/k${i}`)
    await withInMemoryClient(async (client) => {
      const res: any = await client.callTool({ name: 'get_knowledge_bundle', arguments: { ids } })
      expect(res.isError).toBe(true)
      expect(res.structuredContent).toBeUndefined()
      // Tầng T1 (validate input của SDK): handler chưa chạy nên không có
      // `_meta.error` nào được dựng — đó là dấu phân biệt T1 với T2.
      expect(res._meta?.error).toBeUndefined()
      expect(String(res.content[0].text)).toMatch(/\b(most|max|large|many|element)/i)
    })
  })

  test('TC-14: ids rỗng → bundle rỗng', async () => {
    const res = await handleGetKnowledgeBundle({ ids: [] })
    expect(res.isError).toBeFalsy()
    expect(payload(res).bundle).toEqual([])
  })
})

// ═══ Nhóm A · tools/list theo mode (TC-15 … TC-23) ════════════════════════════

const READ_TOOL_NAMES = [
  'get_knowledge_bundle',
  'get_project',
  'get_task_state',
  'list_artifacts',
  'list_projects',
  'list_tasks',
  'read_artifact',
]
const ALL_TOOL_NAMES = [...READ_TOOL_NAMES, 'add_project', 'remove_project'].sort()

/**
 * Client MCP qua in-memory transport.
 *
 * ⚠️ `listTools` nạp validator output phía client; sau đó `callTool` NÉM với
 * mọi kết quả `isError` của tool có `outputSchema` (xem nhóm "nhánh lỗi qua
 * client thật"). Nên chỉ gọi `listTools` ở case thật sự cần.
 */
async function withInMemoryClient<T>(
  fn: (client: Client) => Promise<T>,
  mode: 'readonly' | 'full' = 'full',
): Promise<T> {
  const server = createMcpServer({ mode })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'server-test', version: '1.0.0' })
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  try {
    return await fn(client)
  } finally {
    await client.close()
    await server.close()
  }
}

async function toolsOf(mode?: 'readonly' | 'full'): Promise<any[]> {
  const server = mode ? createMcpServer({ mode }) : createMcpServer()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'server-test', version: '1.0.0' })
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  try {
    return (await client.listTools()).tools
  } finally {
    await client.close()
    await server.close()
  }
}

describe('createMcpServer', () => {
  test('builds a server without connecting a transport', () => {
    expect(createMcpServer()).toBeTruthy()
  })

  test('TC-15: không tham số → đúng 7 tool đọc, KHÔNG có tool ghi (D7)', async () => {
    const names = (await toolsOf()).map((t) => t.name).sort()
    expect(names).toEqual(READ_TOOL_NAMES)
    expect(names).not.toContain('add_project')
    expect(names).not.toContain('remove_project')
  })

  test('TC-16: mode readonly giống hệt mặc định', async () => {
    expect((await toolsOf('readonly')).map((t) => t.name).sort()).toEqual(READ_TOOL_NAMES)
  })

  test('TC-17: mode full → đủ 9 tool', async () => {
    expect((await toolsOf('full')).map((t) => t.name).sort()).toEqual(ALL_TOOL_NAMES)
  })

  test('TC-18: annotations khớp bảng vai trò đọc/ghi', async () => {
    const byName = Object.fromEntries((await toolsOf('full')).map((t) => [t.name, t]))
    for (const name of READ_TOOL_NAMES) {
      expect(byName[name].annotations?.readOnlyHint).toBe(true)
      expect(byName[name].annotations?.openWorldHint).toBe(false)
    }
    // Chiều phủ định: tool GHI không được mang `readOnlyHint: true` — đó đúng
    // là thứ L2 làm client mù.
    expect(byName.add_project.annotations?.readOnlyHint).not.toBe(true)
    expect(byName.add_project.annotations?.destructiveHint).toBe(false)
    expect(byName.add_project.annotations?.idempotentHint).toBe(true)
    expect(byName.add_project.annotations?.openWorldHint).toBe(false)

    expect(byName.remove_project.annotations?.readOnlyHint).not.toBe(true)
    expect(byName.remove_project.annotations?.destructiveHint).toBe(true)
    expect(byName.remove_project.annotations?.idempotentHint).toBe(true)
    expect(byName.remove_project.annotations?.openWorldHint).toBe(false)
  })

  test('TC-19: outputSchema có mặt đúng 7 tool', async () => {
    const tools = await toolsOf('full')
    const withSchema = tools.filter((t) => 'outputSchema' in t).map((t) => t.name).sort()
    expect(withSchema).toEqual([
      'add_project',
      'get_project',
      'get_task_state',
      'list_artifacts',
      'list_projects',
      'list_tasks',
      'remove_project',
    ])
    // G8: hai tool payload lớn cố ý KHÔNG khai — assert vắng mặt.
    for (const name of ['get_knowledge_bundle', 'read_artifact']) {
      expect('outputSchema' in tools.find((t) => t.name === name)!).toBe(false)
    }
  })

  test('TC-20: outputSchema của list_projects là object ở gốc', async () => {
    const tool = (await toolsOf('full')).find((t) => t.name === 'list_projects')!
    expect(tool.outputSchema.type).toBe('object')
    expect(Object.keys(tool.outputSchema.properties)).toEqual(
      expect.arrayContaining(['projects', 'defaultId']),
    )
  })

  test('TC-21: mọi tool có description và inputSchema hợp lệ', async () => {
    for (const tool of await toolsOf('full')) {
      expect(typeof tool.description).toBe('string')
      expect(tool.description!.length).toBeGreaterThan(0)
      expect(tool.inputSchema.type).toBe('object')
    }
    const byName = Object.fromEntries((await toolsOf('full')).map((t) => [t.name, t]))
    const required: Record<string, string[]> = {
      get_project: ['id'],
      add_project: ['path'],
      remove_project: ['id'],
      get_knowledge_bundle: ['ids'],
      get_task_state: ['taskId'],
      list_artifacts: ['taskId'],
      read_artifact: ['taskId', 'name'],
    }
    for (const [name, params] of Object.entries(required)) {
      for (const param of params) expect(byName[name].inputSchema.required).toContain(param)
    }
  })

  test('TC-22: gọi thật mọi tool có outputSchema → SDK validate qua được', async () => {
    // Khai `outputSchema` mà thiếu `structuredContent` là McpError RUNTIME,
    // không phải cảnh báo. Đây là lưới an toàn duy nhất bắt được nó trước khi
    // agent thật gặp (E1/G1).
    const root = workspace()
    fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
    fs.mkdirSync(path.join(root, 'tasks', 'task-a'), { recursive: true })
    fs.writeFileSync(
      path.join(root, '.dev-state', 'task-a.json'),
      JSON.stringify({ task_id: 'task-a', current_phase: 'implementer' }),
    )
    fs.writeFileSync(path.join(root, 'tasks', 'task-a', 'request.md'), '# r\n')
    process.env.DEV_TEAM_ROOT = root

    await withInMemoryClient(async (client) => {
      const added: any = await client.callTool({ name: 'add_project', arguments: { path: proj } })
      expect(added.isError).toBeFalsy()
      const id = added.structuredContent.project.id

      const calls: Array<[string, Record<string, unknown>]> = [
        ['list_projects', {}],
        ['get_project', { id }],
        ['list_tasks', {}],
        ['get_task_state', { taskId: 'task-a' }],
        ['list_artifacts', { taskId: 'task-a' }],
        ['remove_project', { id }],
      ]
      for (const [name, args] of calls) {
        const res: any = await client.callTool({ name, arguments: args })
        expect(res.isError).toBeFalsy()
        expect(res.structuredContent).toBeTruthy()
        // TC-76: hai kênh không được lệch nhau.
        expect(res.structuredContent).toEqual(JSON.parse(res.content[0].text))
      }
    })
  })

  test('TC-23: field lạ trong registry không làm đỏ runtime (.passthrough)', async () => {
    fs.writeFileSync(
      path.join(home, 'projects.json'),
      JSON.stringify({
        version: 1,
        projects: [
          { id: 'p1', name: 'P1', kind: 'local', path: proj, addedAt: 'x', default: true, tags: ['x'] },
        ],
      }),
    )
    await withInMemoryClient(async (client) => {
      const res: any = await client.callTool({ name: 'list_projects', arguments: {} })
      expect(res.isError).toBeFalsy()
      expect(res.structuredContent.projects.map((p: any) => p.id)).toContain('p1')
    })
  })

  test('TC-23b: entry THIẾU field tuỳ chọn vẫn liệt kê được', async () => {
    // Một `projects.json` sửa tay thiếu `kind` từng làm `list_projects` ném
    // `McpError -32602`, khoá agent ra khỏi TOÀN BỘ MCP trong khi REST phục vụ
    // bình thường. `list_projects` là tool discovery duy nhất.
    fs.writeFileSync(
      path.join(home, 'projects.json'),
      JSON.stringify({ version: 1, projects: [{ id: 'p1', name: 'P1', path: proj }] }),
    )
    await withInMemoryClient(async (client) => {
      const list: any = await client.callTool({ name: 'list_projects', arguments: {} })
      expect(list.isError).toBeFalsy()
      expect(list.structuredContent.projects[0].id).toBe('p1')
      const one: any = await client.callTool({ name: 'get_project', arguments: { id: 'p1' } })
      expect(one.isError).toBeFalsy()
      expect(one.structuredContent.project.id).toBe('p1')
    })
  })
})

// ═══ Nhóm A · audit + event cho 2 handler ghi (TC-24 … TC-30) ═════════════════

type Captured = { audits: any[]; events: any[]; stop: () => void }

/** Bắt audit (qua log driver) + event (qua bus) trong phạm vi một case. */
function capture(): Captured {
  const audits: any[] = []
  const events: any[] = []
  setLogDriver({
    append: async (entry: any) => {
      if (entry.type === 'audit') audits.push(entry)
    },
  })
  const off = on('*', (event) => void events.push(event))
  return { audits, events, stop: off }
}

/** `emitAudit` là fire-and-forget — nhường một lượt event loop rồi mới assert. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

describe('audit + event cho đường ghi (L7 / D5)', () => {
  test('TC-24: add_project thành công phát ĐÚNG 1 audit + 1 event', async () => {
    const cap = capture()
    try {
      const res = handleAddProject({ path: proj, name: 'demo' })
      await settle()
      expect(res.isError).toBeUndefined()
      const id = res.structuredContent.project.id
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)

      // ĐÚNG 1, không phải "≥1": phát trùng cũng là lỗi.
      expect(cap.audits).toHaveLength(1)
      expect(cap.audits[0]).toMatchObject({
        op: 'create',
        entity: 'project',
        identifier: id,
        projectId: id,
      })
      const created = cap.events.filter((e) => e.type === 'entity.created')
      expect(created).toHaveLength(1)
      expect(created[0].payload).toMatchObject({ entity: 'project', id, projectId: id })
    } finally {
      cap.stop()
    }
  })

  test('TC-25: payload event không chứa đường dẫn hay bí mật', async () => {
    const cap = capture()
    try {
      const res = handleAddProject({ path: proj, name: 'demo' })
      await settle()
      const id = res.structuredContent.project.id
      const created = cap.events.find((e) => e.type === 'entity.created')!
      expect(created.payload).toEqual({ entity: 'project', id, projectId: id })
      expect(JSON.stringify(created.payload)).not.toContain(proj)
    } finally {
      cap.stop()
    }
  })

  test('TC-26: add_project thất bại KHÔNG phát gì', async () => {
    const cap = capture()
    try {
      const res = handleAddProject({ path: `/khong/ton/tai/${Math.random().toString(36).slice(2)}` })
      await settle()
      expect(res.isError).toBe(true)
      expect(codeOf(res)).toBe('invalid_input')
      expect(cap.audits).toHaveLength(0)
      expect(cap.events).toHaveLength(0)
    } finally {
      cap.stop()
    }
  })

  test('TC-27: remove_project thành công phát ĐÚNG 1 audit + 1 event', async () => {
    const id = handleAddProject({ path: proj }).structuredContent.project.id
    await settle()
    const cap = capture()
    try {
      const res = handleRemoveProject({ id })
      await settle()
      expect(res.isError).toBeUndefined()
      expect(res.structuredContent.removed).toBe(true)
      expect(cap.audits).toHaveLength(1)
      expect(cap.audits[0]).toMatchObject({
        op: 'delete',
        entity: 'project',
        identifier: id,
        projectId: id,
      })
      const deleted = cap.events.filter((e) => e.type === 'entity.deleted')
      expect(deleted).toHaveLength(1)
      expect(deleted[0].payload).toEqual({ entity: 'project', id, projectId: id })
    } finally {
      cap.stop()
    }
  })

  test('TC-28: remove_project id lạ KHÔNG phát gì', async () => {
    const cap = capture()
    try {
      const res = handleRemoveProject({ id: 'khong-ton-tai' })
      await settle()
      expect(codeOf(res)).toBe('not_found')
      expect(cap.audits).toHaveLength(0)
      expect(cap.events).toHaveLength(0)
    } finally {
      cap.stop()
    }
  })

  test('TC-29: emit xảy ra SAU khi trạng thái đã persist', async () => {
    const registryFile = path.join(home, 'projects.json')
    const readIds = (): string[] => {
      try {
        return JSON.parse(fs.readFileSync(registryFile, 'utf8')).projects.map((p: any) => p.id)
      } catch {
        return []
      }
    }

    let idsAtCreate: string[] | null = null
    let idsAtDelete: string[] | null = null
    const offCreate = on('entity.created', () => void (idsAtCreate = readIds()))
    const offDelete = on('entity.deleted', () => void (idsAtDelete = readIds()))
    try {
      const id = handleAddProject({ path: proj }).structuredContent.project.id
      // Bất biến AGENTS.md §4: lúc subscriber chạy, đĩa ĐÃ có project mới.
      expect(idsAtCreate).toContain(id)

      handleRemoveProject({ id })
      expect(idsAtDelete).not.toContain(id)
    } finally {
      offCreate()
      offDelete()
    }
  })

  test('TC-30: tắt ghi audit không làm hỏng thao tác ghi', async () => {
    fs.writeFileSync(
      path.join(home, 'settings.json'),
      JSON.stringify({ logging: { types: { audit: false } } }),
    )
    invalidateLoggingPrefsCache()
    const cap = capture()
    try {
      const res = handleAddProject({ path: proj })
      await settle()
      // Audit là tầng QUAN SÁT, không được thành điểm gãy của đường ghi (E13).
      expect(res.isError).toBeUndefined()
      expect(payload(handleListProjects()).projects).toHaveLength(1)
      expect(cap.audits).toHaveLength(0)
    } finally {
      cap.stop()
    }
  })
})

// ═══ TC-22b · nhánh LỖI nhìn từ CLIENT THẬT ═══════════════════════════════════

describe('TC-22b: nhánh lỗi của tool có outputSchema, nhìn từ client thật', () => {
  test('mọi lượt trả CallToolResult đọc được — không lượt nào ném', async () => {
    // 🔴 Ca đắt giá nhất của spec: nó đã bắt được hồi quy B1 ở lượt S7 trước.
    // Gọi THẲNG handler không bao giờ lộ bug — validator nằm ở
    // `client/index.js:508`, phía client, và chỉ chạy khi client đã biết
    // `outputSchema`. Vì thế `tools/list` ở dưới là BẮT BUỘC: bỏ nó đi thì bộ
    // đệm validator rỗng, không có gì validate, và test xanh giả.
    const root = workspace()
    fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
    fs.mkdirSync(path.join(root, 'tasks', 'task-a'), { recursive: true })
    fs.writeFileSync(
      path.join(root, '.dev-state', 'task-a.json'),
      JSON.stringify({ task_id: 'task-a', current_phase: 'implementer' }),
    )
    process.env.DEV_TEAM_ROOT = root

    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['get_project', { id: 'nope' }, 'not_found'],
      ['add_project', { path: 'relative/x' }, 'invalid_input'],
      ['remove_project', { id: 'nope' }, 'not_found'],
      ['get_task_state', { taskId: 'khong-co' }, 'not_found'],
      ['list_tasks', { project: 'khong-co' }, 'not_found'],
      // ⚠️ `taskId` là tham số BẮT BUỘC của `list_artifacts`; spec ghi thiếu nó
      // ở bảng TC-22b, mà thiếu thì lượt gọi rơi xuống T1 (validate input) và
      // không còn `_meta.error` nào để đọc — xem test-result.md › Lệch spec.
      ['list_artifacts', { taskId: 'task-a', project: 'khong-co' }, 'not_found'],
      ['read_artifact', { taskId: 'task-a', name: '..' }, 'invalid_input'],
    ]

    await withInMemoryClient(async (client) => {
      await client.listTools()
      for (const [name, args, code] of cases) {
        // "Không ném" phải assert TƯỜNG MINH: lượt gọi ném thì mọi assert sau
        // nó không bao giờ chạy tới, và ca đỏ sẽ đọc như một lỗi khác hẳn.
        let res: any
        try {
          res = await client.callTool({ name, arguments: args })
        } catch (err: any) {
          throw new Error(
            `${name} ném thay vì trả CallToolResult — hồi quy B1 quay lại: ${err?.code} ${err?.message}`,
            { cause: err },
          )
        }
        expect(res.isError).toBe(true)
        expect(typeof res.content[0].text).toBe('string')
        expect(res._meta?.error?.code).toBe(code)
        // Khoá `structuredContent` chính là ngòi nổ của B1 — nó phải vắng mặt
        // sau khi đi qua giao thức, không chỉ ở chỗ dựng envelope (TC-04b).
        expect(res.structuredContent).toBeUndefined()
      }
    })
  })
})

// ═══ Nhóm E · tiến trình bun run mcp (TC-88 … TC-92) ══════════════════════════

/** Spawn tiến trình MCP thật, thu `stdout`/`stderr` thô. */
function spawnMcp(env: Record<string, string | undefined>) {
  const child = spawn('bun', ['mcp/server.ts'], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env } as NodeJS.ProcessEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const out: string[] = []
  const err: string[] = []
  child.stdout.on('data', (c) => void out.push(String(c)))
  child.stderr.on('data', (c) => void err.push(String(c)))
  return { child, out, err }
}

async function waitFor(check: () => boolean, ms = 8_000): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (check()) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return check()
}

/** Client MCP nối vào tiến trình `bun mcp/server.ts` thật qua stdio. */
async function withStdioClient<T>(
  env: Record<string, string>,
  args: string[],
  fn: (client: Client, stderrText: () => string) => Promise<T>,
): Promise<T> {
  const chunks: string[] = []
  const transport = new StdioClientTransport({
    command: 'bun',
    args: ['mcp/server.ts', ...args],
    cwd: REPO_ROOT,
    env: { ...process.env, ...env } as Record<string, string>,
    stderr: 'pipe',
  })
  const client = new Client({ name: 'stdio-test', version: '1.0.0' })
  await client.connect(transport)
  transport.stderr?.on('data', (c) => void chunks.push(String(c)))
  try {
    return await fn(client, () => chunks.join(''))
  } finally {
    await client.close()
  }
}

describe('tiến trình bun run mcp (stdio thật)', () => {
  test('TC-88: dòng stderr báo mode + version; stdout sạch', async () => {
    const { child, out, err } = spawnMcp({ DEVTEAM_MCP_MODE: 'full', DEV_TEAM_DASHBOARD_HOME: home })
    try {
      const seen = await waitFor(() => /mode=full/.test(err.join('')))
      expect(seen).toBe(true)
      expect(err.join('')).toContain('1.2.0')
      // `stdout` là kênh JSON-RPC — một dòng log lạc vào đó hỏng cả phiên.
      expect(out.join('')).toBe('')
    } finally {
      child.kill('SIGKILL')
    }
  }, 20_000)

  test('TC-89: mode rác → cảnh báo + chạy readonly, tiến trình KHÔNG thoát', async () => {
    await withStdioClient({ DEVTEAM_MCP_MODE: 'bogus', DEV_TEAM_DASHBOARD_HOME: home }, [], async (client, stderrText) => {
      // Phục vụ được `initialize` + `tools/list` ⇒ sai cấu hình không giết tiến trình.
      const names = (await client.listTools()).tools.map((t) => t.name).sort()
      expect(names).toEqual(READ_TOOL_NAMES)
      await waitFor(() => /mode=readonly/.test(stderrText()))
      expect(stderrText()).toContain('mode=readonly')
      expect(stderrText()).toContain('bogus')
    })
  }, 20_000)

  test('TC-90: tools/list thật qua stdio, không đặt mode → 7 tool đọc', async () => {
    await withStdioClient({ DEV_TEAM_DASHBOARD_HOME: home, DEVTEAM_MCP_MODE: '' }, [], async (client) => {
      const names = (await client.listTools()).tools.map((t) => t.name).sort()
      expect(names).toEqual(READ_TOOL_NAMES)
      expect(names).not.toContain('add_project')
      expect(names).not.toContain('remove_project')
    })
  }, 20_000)

  test('TC-91: CLI flag thắng env trên tiến trình thật', async () => {
    await withStdioClient(
      { DEVTEAM_MCP_MODE: 'readonly', DEV_TEAM_DASHBOARD_HOME: home },
      ['--mode=full'],
      async (client, stderrText) => {
        const names = (await client.listTools()).tools.map((t) => t.name).sort()
        expect(names).toEqual(ALL_TOOL_NAMES)
        await waitFor(() => /mode=full/.test(stderrText()))
        expect(stderrText()).toContain('mode=full')
      },
    )
  }, 20_000)

  test('TC-92: dải khai báo SDK là ^1.29.0 và bản đã cài thoả nó', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))
    const range = pkg.dependencies['@modelcontextprotocol/sdk']
    expect(range).toBe('^1.29.0')

    const installed = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json'),
        'utf8',
      ),
    ).version
    // `^1.29.0`: cùng major, và (minor, patch) không nhỏ hơn.
    const [wantMajor, wantMinor, wantPatch] = range.slice(1).split('.').map(Number)
    const [gotMajor, gotMinor, gotPatch] = String(installed).split('.').map(Number)
    expect(gotMajor).toBe(wantMajor)
    expect(gotMinor * 1e6 + gotPatch).toBeGreaterThanOrEqual(wantMinor * 1e6 + wantPatch)
  })
})
