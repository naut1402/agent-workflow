import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../../src/backend/apiServer.js'
import type { RegistryContext } from '../../../../../src/backend/http/types.js'
import { on, _resetEventBusForTest } from '../../../../../src/backend/events/index.js'
import type { DashboardEvent } from '../../../../../src/backend/events/index.js'
import { resetLogDriver, setLogDriver } from '../../../../../src/backend/log/driver.js'
import { AuditLogEntry, type LogEntry } from '../../../../../src/shared/log/schema.js'
import { MCP_MAX_TIMEOUT_MS } from '../../../../../src/features/mcp/schemas/mcpServer.js'

/**
 * TC-32…TC-43 — contract HTTP `/api/mcp-servers`. Đây là bề mặt quan sát chính
 * của AC-1 (khai báo được MCP server vào hệ thống).
 *
 * `DEV_TEAM_DASHBOARD_HOME` trỏ thư mục tạm: 🚫 không ca nào chạm store thật.
 */

const CANARY = 'sk-CANARY-do-not-log-0123456789'
const FAKE_MCP = path.join(
  import.meta.dir,
  '../../../features/mcp/business/fake-mcp-server.mjs',
)

let root: string
let home: string
let app: Awaited<ReturnType<typeof createApp>>
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME
const prevToken = process.env.MCP_CANARY_TOKEN

/** Mọi entry log đi qua driver này trong suốt suite — sink quan sát được cho audit. */
const logEntries: LogEntry[] = []
let events: DashboardEvent[] = []

function fakeCtx(): RegistryContext {
  return {
    defaultRoot: root,
    resolveProjectRoot: () => root,
    registry: {
      list: () => ({ projects: [], defaultId: null }),
      get: () => null,
      add: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      remove: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      validateProjectPath: (() => ({ ok: false, status: 400, error: 'stub' })) as any,
      seedDefault: () => null,
    },
  }
}

function storeFile(): string {
  return path.join(home, 'mcp-servers.json')
}

function readStore(): { servers: any[] } {
  try {
    return JSON.parse(fs.readFileSync(storeFile(), 'utf8'))
  } catch {
    return { servers: [] }
  }
}

function post(pathname: string, body: unknown) {
  return app.request(pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const STDIO_BODY = {
  id: 'playwright',
  label: 'Playwright MCP',
  enabled: true,
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@playwright/mcp@latest'],
}

function fakeStdioDraft(mode: string, over: Record<string, unknown> = {}) {
  return {
    id: 'probe',
    label: 'probe',
    enabled: true,
    transport: 'stdio',
    command: process.execPath,
    args: [FAKE_MCP, mode],
    ...over,
  }
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-mcp-api-'))
  home = path.join(root, '.home')
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  process.env.MCP_CANARY_TOKEN = CANARY
  fs.mkdirSync(home, { recursive: true })
  app = await createApp(fakeCtx())
  setLogDriver({
    kind: 'file',
    append: async (entry) => {
      logEntries.push(entry)
    },
  })
  for (const type of ['entity.created', 'entity.updated', 'entity.deleted'] as const) {
    on(type, (e) => {
      events.push(e)
    })
  }
})

afterAll(() => {
  resetLogDriver()
  _resetEventBusForTest()
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  if (prevToken === undefined) delete process.env.MCP_CANARY_TOKEN
  else process.env.MCP_CANARY_TOKEN = prevToken
  fs.rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  fs.rmSync(storeFile(), { force: true })
  logEntries.length = 0
  events = []
})

afterEach(() => {
  fs.rmSync(path.join(home, 'credentials.json'), { force: true })
})

describe('GET /api/mcp-servers', () => {
  // TC-32
  test('TC-32: chưa khai gì ⇒ 200 `{ servers: [] }`', async () => {
    const res = await app.request('/api/mcp-servers')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ servers: [] })
  })
})

describe('POST /api/mcp-servers', () => {
  // TC-33
  test('TC-33: tạo server stdio hợp lệ', async () => {
    const res = await post('/api/mcp-servers', { server: STDIO_BODY })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.saved).toBe(true)
    expect(body.server.id).toBe('playwright')

    const listed = await (await app.request('/api/mcp-servers')).json()
    expect(listed.servers).toHaveLength(1)
    expect(listed.servers[0]).toMatchObject({ id: 'playwright', transport: 'stdio', command: 'npx' })
    expect(readStore().servers.map((s: any) => s.id)).toEqual(['playwright'])
  })

  // TC-34 — contract khai ở design: nhận cả hai dạng body.
  test('TC-34: chấp nhận cả body phẳng (không bọc khoá `server`)', async () => {
    const res = await post('/api/mcp-servers', STDIO_BODY)
    expect(res.status).toBe(200)
    expect((await res.json()).saved).toBe(true)
  })

  // TC-35
  test('TC-35: body sai schema ⇒ 400 kèm issue đầu tiên, 🚫 không 500, 🚫 không ghi store', async () => {
    const bad: unknown[] = [
      {}, // (a) body rỗng
      { label: 'thiếu id', transport: 'stdio', command: 'npx' }, // (b)
      { id: 'x', transport: 'websocket', url: 'wss://x' }, // (c)
      { id: 'x', transport: 'stdio' }, // (d) stdio thiếu command
      { id: 'x', transport: 'stdio', command: 'npx', enabled: 'yes' }, // (e)
      '{ khong phai json', // (f)
    ]
    for (const body of bad) {
      const res = await post('/api/mcp-servers', body)
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(typeof json.error).toBe('string')
      expect(json.error.length).toBeGreaterThan(0)
    }
    expect(fs.existsSync(storeFile())).toBe(false)
  })

  // TC-36 — E9
  test('TC-36: url http công cộng ⇒ 400 ngay lúc lưu, store không có entry', async () => {
    const res = await post('/api/mcp-servers', {
      server: { id: 'x', label: 'x', transport: 'http', url: 'http://evil.com/mcp', enabled: true },
    })
    expect(res.status).toBe(400)
    expect(String((await res.json()).error)).toMatch(/loopback|private|cục bộ/i)
    expect(readStore().servers.find((s: any) => s.id === 'x')).toBeUndefined()
  })

  // TC-37 — E10
  test('TC-37: url loopback ⇒ lưu được', async () => {
    const res = await post('/api/mcp-servers', {
      server: { id: 'local', label: 'local', transport: 'http', url: 'http://127.0.0.1:8931/mcp', enabled: true },
    })
    expect(res.status).toBe(200)
    expect((await res.json()).saved).toBe(true)

    const listed = await (await app.request('/api/mcp-servers')).json()
    expect(listed.servers.map((s: any) => s.id)).toContain('local')
  })
})

describe('DELETE / method không hỗ trợ', () => {
  // TC-38 — §6.6 Q1 chốt 200 idempotent cho (b).
  test('TC-38: xoá theo id, idempotent; thiếu id hoặc id rỗng ⇒ 400', async () => {
    await post('/api/mcp-servers', { server: STDIO_BODY })

    const first = await app.request('/api/mcp-servers?id=playwright', { method: 'DELETE' })
    expect(first.status).toBe(200)
    const listed = await (await app.request('/api/mcp-servers')).json()
    expect(listed.servers).toEqual([])

    const second = await app.request('/api/mcp-servers?id=playwright', { method: 'DELETE' })
    expect(second.status).toBe(200)

    expect((await app.request('/api/mcp-servers', { method: 'DELETE' })).status).toBe(400)
    expect((await app.request('/api/mcp-servers?id=', { method: 'DELETE' })).status).toBe(400)
  })

  // TC-39
  test('TC-39: PUT / PATCH ⇒ 405 (không phải 404, không phải 200)', async () => {
    for (const method of ['PUT', 'PATCH']) {
      const res = await app.request('/api/mcp-servers', { method })
      expect(res.status).toBe(405)
    }
  })
})

describe('Audit + domain event', () => {
  /**
   * TC-40 — ca chặn hồi quy `AUDIT_ENTITIES`.
   *
   * `AUDIT_ENTITIES` là zod enum ĐÓNG: thiếu `mcp-server` thì bản ghi audit
   * không parse được. Assert bằng chính schema chứ không bằng chuỗi, nên quên
   * khai enum là ca này đỏ.
   */
  test('TC-40: entity `mcp-server` được audit chấp nhận', async () => {
    const res = await post('/api/mcp-servers', { server: STDIO_BODY })
    expect(res.status).toBe(200)
    await Bun.sleep(10)

    const audits = logEntries.filter((e) => e.type === 'audit')
    expect(audits).toHaveLength(1)
    const parsed = AuditLogEntry.safeParse(audits[0])
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data).toMatchObject({
      op: 'update',
      entity: 'mcp-server',
      identifier: 'playwright',
      projectId: null,
    })
  })

  // TC-41 — G10: payload tối thiểu.
  test('TC-41: mutation phát `entity.updated` / `entity.deleted` với payload tối thiểu', async () => {
    await post('/api/mcp-servers', {
      server: { ...STDIO_BODY, env: { TOKEN: CANARY }, url: undefined },
    })
    await app.request('/api/mcp-servers?id=playwright', { method: 'DELETE' })

    const updated = events.filter((e) => e.type === 'entity.updated')
    const deleted = events.filter((e) => e.type === 'entity.deleted')
    expect(updated).toHaveLength(1)
    expect(deleted).toHaveLength(1)
    expect(updated[0].payload).toEqual({ entity: 'mcp-server', id: 'playwright', projectId: null })
    expect(deleted[0].payload).toEqual({ entity: 'mcp-server', id: 'playwright', projectId: null })

    for (const e of [...updated, ...deleted]) {
      const serialised = JSON.stringify(e.payload)
      for (const forbidden of ['env', 'headers', 'command', 'url', 'credentialId']) {
        expect(e.payload).not.toHaveProperty(forbidden)
      }
      expect(serialised).not.toContain(CANARY)
    }
  })
})

describe('POST /api/mcp-servers/test', () => {
  // TC-42
  test('TC-42: bản nháp chưa lưu ⇒ probe chạy, store VẪN rỗng, 🚫 không event `entity.*`', async () => {
    const res = await post('/api/mcp-servers/test', { server: fakeStdioDraft('ok'), listTools: true })
    expect(res.status).toBe(200)
    const body = await res.json()
    // `error` là `undefined` khi probe OK nên JSON bỏ khoá — đó là ngữ nghĩa
    // JSON bình thường, không phải thiếu contract; assert nó vắng mặt cho rõ.
    for (const key of ['ok', 'serverInfo', 'tools', 'warnings', 'durationMs']) {
      expect(Object.keys(body)).toContain(key)
    }
    expect(body.error).toBeUndefined()
    expect(body.ok).toBe(true)
    expect(body.tools.length).toBeGreaterThanOrEqual(2)

    expect(readStore().servers).toEqual([])
    expect(events.filter((e) => e.type.startsWith('entity.'))).toEqual([])
  }, 30_000)

  // TC-43 (a)
  test('TC-43 (a): server đã lưu ⇒ `lastCheck` được cập nhật', async () => {
    await post('/api/mcp-servers', { server: fakeStdioDraft('ok') })
    const res = await post('/api/mcp-servers/test', { server: fakeStdioDraft('ok'), listTools: true })
    expect((await res.json()).ok).toBe(true)

    const saved = readStore().servers.find((s: any) => s.id === 'probe')
    expect(saved.lastCheck.ok).toBe(true)
    expect(saved.lastCheck.toolCount).toBeGreaterThanOrEqual(2)
    expect(Number.isNaN(Date.parse(saved.lastCheck.at))).toBe(false)
  }, 30_000)

  /**
   * TC-43 (b) — E15: thông điệp lỗi mang secret phải ra ngoài đã mask.
   *
   * ⚠️ Lệch cách dựng so với `test-spec.md`: spec mô tả một MCP server HTTP từ
   * xa trả lỗi có token. §1.4 cấm gọi mạng thật, nên ca này dựng cùng tình
   * huống bằng stdio: giá trị canary nằm trong `env` của server (⇒ có trong
   * danh sách `secrets`) VÀ xuất hiện nguyên văn trong thông điệp lỗi do
   * transport sinh ra. Bất biến được chấm không đổi: canary 🚫 không có mặt ở
   * bất kỳ đâu trong body response.
   */
  test('TC-43 (b): thông điệp lỗi mang canary ⇒ response đã mask, body không chứa canary', async () => {
    const res = await post('/api/mcp-servers/test', {
      server: {
        id: 'leaky',
        label: 'leaky',
        enabled: true,
        transport: 'stdio',
        // Tên lệnh không tồn tại chính là giá trị secret ⇒ lỗi ENOENT mang canary.
        command: CANARY,
        args: [],
        env: { TOKEN: CANARY },
      },
      listTools: true,
    })

    expect(res.status).toBe(200)
    const raw = await res.text()
    const body = JSON.parse(raw)
    expect(body.ok).toBe(false)
    expect(body.error).toContain('***')
    expect(body.error).not.toContain(CANARY)
    expect(raw).not.toContain(CANARY)
  }, 30_000)
})

/* ─── Tdad47b2b · nhóm F — hợp đồng endpoint lưu MCP server ───────────────── */

/**
 * TC-F01…TC-F08 — biên `timeoutMs` và dạng `id`.
 *
 * Hai điểm đáng nhớ:
 *   - trần `timeoutMs` nới theo trần của CLI (600s), nhưng 🚫 KHÔNG có sàn ở tầng
 *     validate: bản ghi v1 giữ giá trị dưới sàn phải lưu lại được, việc kẹp về
 *     miền `[5s, 600s]` xảy ra lúc SINH file config (`serialize.test.ts` TC-C03);
 *   - hợp đồng `id` 🚫 KHÔNG đổi trong task này. Id giờ do giao diện nội suy, và
 *     đó chính là lý do nó phải sinh ra đã ở dạng canonical — sai một ký tự là 400.
 */
describe('POST /api/mcp-servers — biên timeoutMs và dạng id (nhóm F)', () => {
  // TC-F01
  test('TC-F01: `timeoutMs` bằng trần mới ⇒ 2xx, lưu đúng giá trị', async () => {
    const res = await post('/api/mcp-servers', {
      server: { ...STDIO_BODY, timeoutMs: MCP_MAX_TIMEOUT_MS },
    })
    expect(res.status).toBe(200)
    expect(readStore().servers.find((s: any) => s.id === 'playwright').timeoutMs).toBe(MCP_MAX_TIMEOUT_MS)
  })

  // TC-F02
  test('TC-F02: vượt trần ⇒ 400, 🚫 không ghi gì vào store', async () => {
    const res = await post('/api/mcp-servers', {
      server: { ...STDIO_BODY, timeoutMs: MCP_MAX_TIMEOUT_MS + 1 },
    })
    expect(res.status).toBe(400)
    expect(fs.existsSync(storeFile())).toBe(false)
  })

  // TC-F03 — 🚫 KHÔNG đặt sàn ở tầng validate.
  test('TC-F03: giá trị nhỏ (15000, 1000) vẫn lưu được ⇒ 2xx', async () => {
    for (const timeoutMs of [15_000, 1000]) {
      const res = await post('/api/mcp-servers', { server: { ...STDIO_BODY, timeoutMs } })
      expect(res.status).toBe(200)
      expect(readStore().servers.find((s: any) => s.id === 'playwright').timeoutMs).toBe(timeoutMs)
    }
  })

  // TC-F04
  test('TC-F04: id không chuẩn (khoảng trắng / chữ hoa lẫn dấu) ⇒ 400, hợp đồng id 🚫 không đổi', async () => {
    for (const id of ['Playwright MCP', 'my.server', 'tên-có-dấu', 'a/b']) {
      const res = await post('/api/mcp-servers', { server: { ...STDIO_BODY, id } })
      expect(res.status).toBe(400)
    }
    expect(fs.existsSync(storeFile())).toBe(false)
  })

  // TC-F05 — giao diện luôn gửi id nội suy, nhưng backend vẫn đòi trường này.
  test('TC-F05: body 🚫 không có `id` ⇒ 400', async () => {
    const { id: _omit, ...withoutId } = STDIO_BODY
    const res = await post('/api/mcp-servers', { server: withoutId })
    expect(res.status).toBe(400)
    expect(fs.existsSync(storeFile())).toBe(false)
  })

  // TC-F06 — upsert thuần: task này 🚫 không thêm chặn ghi đè (§6).
  test('TC-F06: lưu hai lần cùng id ⇒ lần hai ghi đè, 🚫 không nhân đôi', async () => {
    await post('/api/mcp-servers', { server: { ...STDIO_BODY, label: 'v1' } })
    const second = await post('/api/mcp-servers', { server: { ...STDIO_BODY, label: 'v2' } })

    expect(second.status).toBe(200)
    const stored = readStore().servers.filter((s: any) => s.id === 'playwright')
    expect(stored).toHaveLength(1)
    expect(stored[0].label).toBe('v2')
  })

  // TC-F07 — biên trên chấp nhận được; đây là biên mà id nội suy bám sát (TC-A12/A13).
  test('TC-F07: id đúng 64 ký tự hợp lệ ⇒ 2xx', async () => {
    const id = 'a'.repeat(64)
    const res = await post('/api/mcp-servers', { server: { ...STDIO_BODY, id } })
    expect(res.status).toBe(200)
    expect(readStore().servers.map((s: any) => s.id)).toContain(id)
  })

  // TC-F08
  test('TC-F08: id 65 ký tự ⇒ 400, 🚫 không âm thầm cắt rồi lưu', async () => {
    const id = 'a'.repeat(65)
    const res = await post('/api/mcp-servers', { server: { ...STDIO_BODY, id } })
    expect(res.status).toBe(400)
    expect(fs.existsSync(storeFile())).toBe(false)
  })
})

/**
 * TC-SEC-30…TC-SEC-38 + TC-SEC-DEST — biên API cho secret literal trong
 * `stdio.args` (#385 SEC-5 / SEC-7 / SEC-14, PR 1).
 *
 * Canary riêng, khác `CANARY` ở đầu file: ca ở đây quét **toàn văn** body
 * response nên chuỗi phải là duy nhất và dễ `grep` (`test-spec.md` §2.3).
 */
const ARGS_CANARY = 'sk-test-LEAKCANARY-0123456789'

/** Server stdio có secret literal nằm ở `args` — nguyên liệu chung của nhóm. */
const SECRET_ARGS_BODY = {
  id: 'args-secret',
  label: 'Args secret',
  enabled: true,
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '--token', ARGS_CANARY],
}

async function bodyText(res: Response): Promise<string> {
  return await res.text()
}

describe('Secret literal trong `stdio.args` — biên API (#385)', () => {
  // TC-SEC-30 ⭐
  test('TC-SEC-30: GET /api/mcp-servers ⇒ body 🚫 chứa canary, `args` hiện `***`', async () => {
    expect((await post('/api/mcp-servers', { server: SECRET_ARGS_BODY })).status).toBe(200)

    const res = await app.request('/api/mcp-servers')
    const raw = await bodyText(res)

    expect(res.status).toBe(200)
    expect(raw).not.toContain(ARGS_CANARY)
    const server = JSON.parse(raw).servers.find((s: any) => s.id === 'args-secret')
    expect(server.args).toEqual([
      '-y',
      '@modelcontextprotocol/server-filesystem',
      '--token',
      '***',
    ])
  })

  /**
   * TC-SEC-31 — 🚫 KHÔNG có route `GET /api/mcp-servers/<id>` (xem
   * `src/features/mcp/api.ts`: 4 route + 1 fallback). Nên "mọi route trả
   * `McpServerConfig`" ở đây là **ba** đường, và cả ba đều phải assert — assert
   * một rồi suy ra hai cái kia đúng là thứ §2.3 cấm.
   */
  test('TC-SEC-31: MỌI route trả McpServerConfig đều đã mask', async () => {
    // (1) Response của chính lượt lưu.
    const saveRes = await post('/api/mcp-servers', { server: SECRET_ARGS_BODY })
    const saveRaw = await bodyText(saveRes)
    expect(saveRaw).not.toContain(ARGS_CANARY)
    expect(JSON.parse(saveRaw).server.args).toContain('***')

    // (2) Route danh sách.
    expect(await bodyText(await app.request('/api/mcp-servers'))).not.toContain(ARGS_CANARY)

    // (3) Route kiểm tra kết nối (trả `tools` + `warnings`, 🚫 trả lại cấu hình).
    const testRaw = await bodyText(
      await post('/api/mcp-servers/test', { server: SECRET_ARGS_BODY, listTools: false }),
    )
    expect(testRaw).not.toContain(ARGS_CANARY)

    // (4) Route 405 và route xoá cũng 🚫 được vọng lại gì.
    expect(await bodyText(await app.request('/api/mcp-servers', { method: 'PUT' }))).not.toContain(
      ARGS_CANARY,
    )
  })

  // TC-SEC-32 ⭐ — round-trip THẬT, đo trên file registry trên đĩa.
  test('TC-SEC-32: GET → gửi nguyên body đó đi lưu ⇒ file trên đĩa vẫn giữ secret THẬT', async () => {
    await post('/api/mcp-servers', { server: SECRET_ARGS_BODY })
    const listed = JSON.parse(await bodyText(await app.request('/api/mcp-servers')))
    const masked = listed.servers.find((s: any) => s.id === 'args-secret')
    expect(masked.args).toContain('***')

    // Gửi NGUYÊN bản đã mask ngược lên — đúng thứ dialog làm khi bấm Lưu mà 🚫 sửa gì.
    const again = await post('/api/mcp-servers', { server: masked })
    expect(again.status).toBe(200)

    const onDisk = fs.readFileSync(storeFile(), 'utf8')
    expect(onDisk).toContain(ARGS_CANARY)
    expect(onDisk).not.toContain('***')
  })

  // TC-SEC-33 ⭐
  test('TC-SEC-33: Kiểm tra kết nối với bản nháp Y HỆT bản đã lưu ⇒ 🚫 báo đổi đích', async () => {
    const draft = fakeStdioDraft('ok', {
      id: 'same-target',
      args: [FAKE_MCP, 'ok', '--token', ARGS_CANARY],
    })
    await post('/api/mcp-servers', { server: draft })

    const listed = JSON.parse(await bodyText(await app.request('/api/mcp-servers')))
    const masked = listed.servers.find((s: any) => s.id === 'same-target')
    expect(masked.args).toContain('***')

    const res = await post('/api/mcp-servers/test', { server: masked, listTools: true })
    const raw = await bodyText(res)

    expect(res.status).toBe(200)
    expect(raw).not.toContain('đích kết nối đã đổi')
    expect(raw).not.toContain(ARGS_CANARY)
    // Probe dùng giá trị THẬT ⇒ server giả chạy được và trả tool.
    expect(JSON.parse(raw).ok).toBe(true)
  }, 30_000)

  // TC-SEC-34 — tính chất bảo mật của guard 🚫 bị nới cùng lúc.
  test('TC-SEC-34: đổi `command` / đổi một arg KHÔNG phải secret ⇒ 400 báo đổi đích', async () => {
    const draft = fakeStdioDraft('ok', {
      id: 'moved-target',
      args: [FAKE_MCP, 'ok', '--token', ARGS_CANARY],
    })
    await post('/api/mcp-servers', { server: draft })
    const listed = JSON.parse(await bodyText(await app.request('/api/mcp-servers')))
    const masked = listed.servers.find((s: any) => s.id === 'moved-target')

    const movedCommand = await post('/api/mcp-servers/test', {
      server: { ...masked, command: '/bin/echo' },
    })
    expect(movedCommand.status).toBe(400)
    expect(await bodyText(movedCommand)).toContain('đích kết nối đã đổi')

    const movedArg = await post('/api/mcp-servers/test', {
      server: { ...masked, args: [FAKE_MCP, 'hang', '--token', '***'] },
    })
    expect(movedArg.status).toBe(400)
    expect(await bodyText(movedArg)).toContain('đích kết nối đã đổi')
  })

  /**
   * TC-SEC-DEST (review vòng 1) — chống hồi quy cho `destinationOf`.
   * Khai thác: đổi giá trị đứng sau `--auth` nhưng GIỮ `--token: ***`. Nếu
   * `destinationOf` so trên bản đã MASK thì hai vế bằng nhau ⇒ secret thật được
   * khôi phục rồi probe tới đích của kẻ gửi. Guard phải CHẶN.
   */
  test('TC-SEC-DEST: đổi giá trị sau `--auth`, giữ `--token: ***` ⇒ 400, 🚫 probe', async () => {
    const saved = fakeStdioDraft('ok', {
      id: 'dest-guard',
      args: [FAKE_MCP, 'ok', '--auth', 'https://internal.example', '--token', ARGS_CANARY],
    })
    await post('/api/mcp-servers', { server: saved })

    const attack = await post('/api/mcp-servers/test', {
      server: {
        ...saved,
        args: [FAKE_MCP, 'ok', '--auth', 'https://attacker.example', '--token', '***'],
      },
    })
    const raw = await bodyText(attack)

    expect(attack.status).toBe(400)
    expect(raw).toContain('đích kết nối đã đổi')
    expect(raw).not.toContain(ARGS_CANARY)
  })

  /**
   * TC-SEC-35 — server MỚI (🚫 có bản cũ) mà `args` chứa `***`. Hai đường vào, và
   * chúng **🚫 cùng một kết luận** — phải khoá cả hai, 🚫 assert một rồi suy ra:
   *   - `POST /test` ⇒ **400** "đích kết nối đã đổi" (🚫 có bản lưu để khôi phục);
   *   - `POST` (lưu) ⇒ **2xx** nhưng ô `***` bị **BỎ HẲN** + cảnh báo
   *     `args.secretDropped`. Đây là lựa chọn có chủ ý: chặn lượt Lưu nghĩa là
   *     một cấu hình đang chạy 🚫 bấm Lưu lại được nữa (D4). Điều bắt buộc —
   *     và là điều ca này canh — là literal `***` 🚫 BAO GIỜ chạm store.
   */
  test('TC-SEC-35: server MỚI mà `args` chứa `***` ⇒ 🚫 ghi literal `***` xuống store', async () => {
    const res = await post('/api/mcp-servers/test', {
      server: { ...SECRET_ARGS_BODY, id: 'brand-new', args: ['-y', 'pkg', '--token', '***'] },
    })

    expect(res.status).toBe(400)
    expect(await bodyText(res)).toContain('đích kết nối đã đổi')
    expect(readStore().servers.map((s: any) => s.id)).not.toContain('brand-new')

    const saved = await post('/api/mcp-servers', {
      server: { ...SECRET_ARGS_BODY, id: 'brand-new', args: ['-y', 'pkg', '--token', '***'] },
    })
    const body = JSON.parse(await bodyText(saved))

    expect(saved.status).toBe(200)
    expect(body.warnings).toContain('args.secretDropped')
    expect(body.server.args).toEqual(['-y', 'pkg', '--token'])
    expect(fs.readFileSync(storeFile(), 'utf8')).not.toContain('***')
  })

  // TC-SEC-36
  test('TC-SEC-36: payload audit + domain event 🚫 chứa canary', async () => {
    await post('/api/mcp-servers', { server: SECRET_ARGS_BODY })

    expect(events.length).toBeGreaterThan(0)
    expect(JSON.stringify(events)).not.toContain(ARGS_CANARY)
    expect(logEntries.length).toBeGreaterThan(0)
    expect(JSON.stringify(logEntries)).not.toContain(ARGS_CANARY)
  })

  // TC-SEC-37 ⭐ — CẢNH BÁO, 🚫 CHẶN. Cấu hình đang chạy vẫn phải lưu lại được.
  test('TC-SEC-37: `args` có literal nghi secret ⇒ 2xx kèm cảnh báo, 🚫 4xx', async () => {
    const res = await post('/api/mcp-servers', { server: SECRET_ARGS_BODY })
    const body = JSON.parse(await bodyText(res))

    expect(res.status).toBe(200)
    expect(body.saved).toBe(true)
    expect(body.warnings).toContain('args.secretLiteral')
    // Lưu lại lần nữa (bản đã mask) vẫn 2xx — cấu hình đã lưu 🚫 bị kẹt.
    const listed = JSON.parse(await bodyText(await app.request('/api/mcp-servers')))
    const masked = listed.servers.find((s: any) => s.id === 'args-secret')
    expect((await post('/api/mcp-servers', { server: masked })).status).toBe(200)
  })

  // TC-SEC-38 — 🚫 báo động giả.
  test('TC-SEC-38: `args` 🚫 có gì nghi secret ⇒ 🚫 cảnh báo', async () => {
    const res = await post('/api/mcp-servers', {
      server: {
        ...SECRET_ARGS_BODY,
        id: 'clean-args',
        args: [
          '-y',
          '@modelcontextprotocol/server-filesystem',
          '/home/user/projects/agent-workflow/.dev-team-agent',
          '--port',
          '8080',
        ],
      },
    })
    const body = JSON.parse(await bodyText(res))

    expect(res.status).toBe(200)
    expect(body.warnings).toEqual([])
  })

  /**
   * TC-SEC-DLG (review vòng 1), vế backend — lưu một server mà ô `***` neo LỆCH
   * ⇒ response phải mang `args.secretDropped` để dialog còn thứ để hiển thị.
   * Vế FE (dialog 🚫 đóng mất) nằm ở `McpServerDialog.test.ts`.
   */
  test('TC-SEC-DLG: lưu với ô `***` neo lệch ⇒ response mang `args.secretDropped`', async () => {
    await post('/api/mcp-servers', { server: SECRET_ARGS_BODY })

    const shifted = await post('/api/mcp-servers', {
      server: {
        ...SECRET_ARGS_BODY,
        args: ['-y', '@modelcontextprotocol/server-filesystem', '--extra', '--token', '***'],
      },
    })
    const body = JSON.parse(await bodyText(shifted))

    expect(shifted.status).toBe(200)
    expect(body.warnings).toContain('args.secretDropped')
    // Ô `***` bị BỎ HẲN — 🚫 ghi literal `***` xuống store.
    expect(body.server.args).not.toContain('***')
    expect(fs.readFileSync(storeFile(), 'utf8')).not.toContain('"***"')
  })
})
