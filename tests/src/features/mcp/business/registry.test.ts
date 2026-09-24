import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  deleteMcpServer,
  listMcpServers,
  loadMcpServers,
  recordCheckResult,
  upsertMcpServer,
} from '../../../../../src/features/mcp/business/registry.js'
import {
  MCP_DEFAULT_TIMEOUT_MS,
  MCP_MASK,
  MCP_SERVERS_VERSION,
  maskSecretValues,
  sanitiseMcpServerId,
  type McpServerConfig,
  type McpStdioServer,
} from '../../../../../src/features/mcp/business/types.js'

/**
 * TC-01…TC-10 · TC-96 · TC-97 — store `mcp-servers.json`.
 *
 * Mỗi ca trỏ `DEV_TEAM_DASHBOARD_HOME` vào một thư mục tạm riêng (test-spec §1.4:
 * 🚫 không ca nào được ghi vào workspace người dùng). Registry đọc lại đĩa mỗi
 * lần gọi nên không cần reset cache (§6.6 Q3 — đã đối chứng với `loadMcpServers`).
 */

const CANARY = 'sk-CANARY-do-not-log-0123456789'
/** BOM viết bằng escape: ký tự thật trong source vi phạm `no-irregular-whitespace`. */
const BOM = String.fromCharCode(0xfeff)

let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

function storeFile(): string {
  return path.join(home, 'mcp-servers.json')
}

function readStoreRaw(): string {
  return fs.readFileSync(storeFile(), 'utf8')
}

function stdio(over: Partial<McpStdioServer> & { id: string }): McpStdioServer {
  return {
    label: over.id,
    enabled: true,
    transport: 'stdio',
    command: 'node',
    args: [],
    env: {},
    ...over,
  } as McpStdioServer
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-mcp-registry-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})

afterEach(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
})

describe('mcp registry — đọc store', () => {
  // TC-01
  test('TC-01: chưa có file store ⇒ mảng rỗng, không ném, không tự tạo file', () => {
    expect(listMcpServers()).toEqual([])
    expect(fs.existsSync(storeFile())).toBe(false)
  })

  // TC-02
  test('TC-02: file hỏng / BOM / không phải JSON ⇒ rỗng, 🚫 không ghi đè file gốc', () => {
    const variants = ['', '{', BOM + '{"version":1,"servers":[]}', 'not json']
    for (const raw of variants) {
      fs.writeFileSync(storeFile(), raw, 'utf8')
      expect(listMcpServers()).toEqual([])
      // Bytes y nguyên: registry là dữ liệu ngoài, đọc phòng thủ chứ không seed lại.
      expect(readStoreRaw()).toBe(raw)
    }
  })
})

describe('mcp registry — upsert / delete', () => {
  // TC-03
  test('TC-03: upsert server mới rồi đọc lại', () => {
    const result = upsertMcpServer(
      stdio({
        id: 'playwright',
        label: 'Playwright MCP',
        command: 'npx',
        args: ['-y', '@playwright/mcp@latest'],
      }),
    )
    expect(result.ok).toBe(true)

    const list = listMcpServers()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      id: 'playwright',
      label: 'Playwright MCP',
      enabled: true,
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
      env: {},
    })

    const parsed = JSON.parse(readStoreRaw())
    expect(parsed.version).toBeTruthy()
    expect(parsed.servers).toHaveLength(1)
  })

  // TC-04
  test('TC-04: upsert trùng id ⇒ ghi đè, không nhân đôi', () => {
    upsertMcpServer(stdio({ id: 'playwright', label: 'Playwright MCP', command: 'npx' }))
    upsertMcpServer(stdio({ id: 'playwright', label: 'PW v2', enabled: false, command: 'npx' }))

    const list = listMcpServers()
    expect(list).toHaveLength(1)
    expect(list[0].label).toBe('PW v2')
    expect(list[0].enabled).toBe(false)
  })

  // TC-05
  test('TC-05: xoá idempotent, id lạ không ném', () => {
    upsertMcpServer(stdio({ id: 'playwright', command: 'npx' }))

    const first = deleteMcpServer('playwright')
    expect(first).toMatchObject({ ok: true, deleted: true, id: 'playwright' })
    expect(listMcpServers()).toEqual([])

    // (b) gọi lại lần nữa — §6.6 Q1 chốt 200 idempotent, không ném.
    expect(deleteMcpServer('playwright')).toMatchObject({ ok: true, deleted: false })
    // (c) id chưa từng tồn tại.
    expect(deleteMcpServer('khong-ton-tai')).toMatchObject({ ok: true, deleted: false })
    expect(listMcpServers()).toEqual([])
  })
})

describe('sanitiseMcpServerId', () => {
  // TC-06
  test('TC-06: id hợp lệ đi qua nguyên vẹn', () => {
    for (const id of ['playwright', 'serena-2', 'A-b_0']) {
      expect(sanitiseMcpServerId(id)).toBe(id)
    }
  })

  // TC-07 (A) — từ chối
  test('TC-07 (A): id nguy hiểm ⇒ null', () => {
    const rejected = ['a/b', 'a\\b', 'ab\0cd', '..', '../etc/passwd', '', '   ', '.']
    for (const id of rejected) {
      expect(sanitiseMcpServerId(id)).toBeNull()
    }
  })

  // TC-07 (B) — chuẩn hoá
  test('TC-07 (B): id phải chuẩn hoá ⇒ chuỗi đã lọc, KHÔNG phải null', () => {
    expect(sanitiseMcpServerId('my_server.v1')).toBe('my_serverv1')
    expect(sanitiseMcpServerId('tên-có-dấu')).toBe('tn-c-du')
    expect(sanitiseMcpServerId('x'.repeat(500))).toBe('x'.repeat(64))
  })

  // TC-07 — bất biến chung cho cả (A) và (B)
  test('TC-07: giá trị trả về không bao giờ chứa `/`, `\\`, NUL hay `..`', () => {
    const inputs = [
      'playwright',
      'my_server.v1',
      'tên-có-dấu',
      'x'.repeat(500),
      'a/b',
      'a\\b',
      'ab\0cd',
      '..',
      '../etc/passwd',
      '',
      '   ',
      '.',
    ]
    for (const id of inputs) {
      const out = sanitiseMcpServerId(id)
      if (out === null) continue
      expect(out).not.toContain('/')
      expect(out).not.toContain('\\')
      expect(out).not.toContain('\0')
      expect(out).not.toContain('..')
    }
  })
})

describe('recordCheckResult', () => {
  // TC-08
  test('TC-08: id không có trong store ⇒ no-op, không tạo entry', () => {
    expect(() =>
      recordCheckResult('khong-ton-tai', {
        at: new Date().toISOString(),
        ok: true,
        toolCount: 3,
        toolNames: ['a'],
      }),
    ).not.toThrow()
    expect(listMcpServers()).toEqual([])
  })

  // TC-09
  test('TC-09: giới hạn dữ liệu tóm tắt — count là số thật, tên bị cắt', () => {
    upsertMcpServer(stdio({ id: 'big', command: 'node' }))
    const names = Array.from({ length: 300 }, (_, i) => `t${i}-${'n'.repeat(500)}`)
    recordCheckResult('big', {
      at: new Date().toISOString(),
      ok: true,
      toolCount: names.length,
      toolNames: names,
    })

    const saved = listMcpServers()[0]
    expect(saved.lastCheck?.toolCount).toBe(300)
    expect(saved.lastCheck!.toolNames.length).toBeLessThanOrEqual(50)
    for (const n of saved.lastCheck!.toolNames) {
      expect(n.length).toBeLessThanOrEqual(120)
    }
    expect(Number.isNaN(Date.parse(saved.lastCheck!.at))).toBe(false)
  })
})

describe('mcp registry — env đã tước', () => {
  // TC-10
  test('TC-10: HOME rỗng + home trỏ path chưa tồn tại ⇒ đọc rỗng, ghi không thất bại im lặng', () => {
    const prevRealHome = process.env.HOME
    const missing = path.join(home, 'khong-ton-tai', 'nested', 'dev-team-home')
    process.env.HOME = ''
    process.env.DEV_TEAM_DASHBOARD_HOME = missing
    try {
      expect(listMcpServers()).toEqual([])

      let threw: Error | null = null
      try {
        upsertMcpServer(stdio({ id: 'probe', command: 'node' }))
      } catch (err) {
        threw = err as Error
      }

      if (threw) {
        // Nhánh hợp lệ thứ hai: ném lỗi có thông điệp nêu đường dẫn.
        expect(String(threw.message)).toContain(missing)
      } else {
        // Nhánh hợp lệ thứ nhất: tạo được cây thư mục và lưu thật — đọc lại phải thấy.
        expect(listMcpServers().map((s) => s.id)).toEqual(['probe'])
      }
    } finally {
      if (prevRealHome === undefined) delete process.env.HOME
      else process.env.HOME = prevRealHome
    }
  })
})

describe('mcp registry — sentinel `***` (chống ghi đè secret thật)', () => {
  function seedWithCanary(): McpServerConfig {
    upsertMcpServer(stdio({ id: 'probe', command: 'node', env: { TOKEN: CANARY } }))
    return listMcpServers()[0]
  }

  function storedEnv(id = 'probe'): Record<string, string> {
    const parsed = JSON.parse(readStoreRaw())
    return parsed.servers.find((s: any) => s.id === id).env
  }

  // TC-96
  test('TC-96 (a): bật/tắt bằng bản đã mask ⇒ secret thật giữ nguyên', () => {
    const masked = maskSecretValues(seedWithCanary()) as McpStdioServer
    expect(masked.env.TOKEN).toBe(MCP_MASK)

    upsertMcpServer({ ...masked, enabled: false })

    expect(storedEnv().TOKEN).toBe(CANARY)
    expect(readStoreRaw()).not.toContain(MCP_MASK)
    expect(listMcpServers()[0].enabled).toBe(false)
  })

  // TC-96
  test('TC-96 (b): chỉ sửa nhãn ⇒ secret thật giữ nguyên', () => {
    const masked = maskSecretValues(seedWithCanary()) as McpStdioServer

    upsertMcpServer({ ...masked, label: 'renamed' })

    expect(storedEnv().TOKEN).toBe(CANARY)
    expect(readStoreRaw()).not.toContain(MCP_MASK)
    expect(listMcpServers()[0].label).toBe('renamed')
  })

  // TC-96 — ca dễ hỏng nhất khi ai đó viết lại `mergeMaskedSecrets`.
  test('TC-96 (c): thêm khoá mới cạnh khoá đã mask ⇒ giữ cũ, nhận mới', () => {
    const masked = maskSecretValues(seedWithCanary()) as McpStdioServer

    upsertMcpServer({ ...masked, env: { ...masked.env, EXTRA: 'plain-value' } })

    const env = storedEnv()
    expect(env.TOKEN).toBe(CANARY)
    expect(env.EXTRA).toBe('plain-value')
    expect(readStoreRaw()).not.toContain(MCP_MASK)
  })

  // TC-97
  test('TC-97 (a): id mới hoàn toàn mang `***` ⇒ bỏ khoá, 🚫 không ghi literal', () => {
    upsertMcpServer(stdio({ id: 'copy', command: 'node', env: { TOKEN: MCP_MASK } }))

    expect(storedEnv('copy')).toEqual({})
    expect(readStoreRaw()).not.toContain(MCP_MASK)
  })

  // TC-97
  test('TC-97 (b): thêm khoá mới mang `***` vào server đã có ⇒ bỏ khoá đó, giữ khoá cũ', () => {
    const masked = maskSecretValues(seedWithCanary()) as McpStdioServer

    upsertMcpServer({ ...masked, env: { ...masked.env, NEW: MCP_MASK } })

    const env = storedEnv()
    expect(env.TOKEN).toBe(CANARY)
    expect(env).not.toHaveProperty('NEW')
    expect(readStoreRaw()).not.toContain(MCP_MASK)
  })
})

/* ─── Tdad47b2b · nhóm E — nâng phiên bản store + migrate `timeoutMs` ─────── */

/**
 * TC-E01…TC-E11 — ngữ nghĩa `timeoutMs` ĐỔI ở v2.
 *
 * v1: con số chỉ tác động nút Kiểm tra kết nối. v2: nó còn được ghi xuống
 * `startupTimeoutSec` của file config, nên nó tác động cả lúc job chạy server.
 * Vì thế migrate **bỏ trường ở MỌI bản ghi v1 có giá trị < mặc định mới** —
 * người đặt `30000` ở v1 đang chọn «probe chờ 30s», họ chưa từng chọn «job cho
 * server 30s để khởi động». Giá trị ≥ mặc định mới được GIỮ: nó chỉ làm job chờ
 * lâu hơn, 🚫 không thuộc lớp hồi quy mà migrate này chặn.
 */
function writeStore(raw: unknown) {
  fs.writeFileSync(storeFile(), typeof raw === 'string' ? raw : JSON.stringify(raw), 'utf8')
}

function v1Server(over: Record<string, unknown> = {}) {
  return {
    id: 'playwright',
    label: 'Playwright MCP',
    enabled: true,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    env: {},
    ...over,
  }
}

describe('mcp registry — migrate v1 → v2 (nhóm E)', () => {
  // TC-E01
  test('TC-E01: v1 giữ mặc định cũ 15000 ⇒ BỎ trường, phiên bản store báo 2', () => {
    writeStore({ version: 1, servers: [v1Server({ timeoutMs: 15_000 })] })

    const store = loadMcpServers()
    expect(store.version).toBe(MCP_SERVERS_VERSION)
    expect(MCP_SERVERS_VERSION).toBe(2)
    expect(store.servers[0]).not.toHaveProperty('timeoutMs')
  })

  /**
   * TC-E02 — bản ghi v1 do người dùng tự đặt cũng bị bỏ trường.
   *
   * ⚠️ Áp dụng cho MỌI giá trị v1 < mặc định mới, không riêng `15000`: giữ lại
   * `30000` là im lặng rút thời gian khởi động của job từ 120s xuống 30s.
   */
  test('TC-E02: mọi giá trị v1 dưới mặc định mới ⇒ BỎ trường', () => {
    for (const timeoutMs of [1, 1000, 15_000, 30_000, 60_000, MCP_DEFAULT_TIMEOUT_MS - 1]) {
      writeStore({ version: 1, servers: [v1Server({ timeoutMs })] })
      expect(loadMcpServers().servers[0]).not.toHaveProperty('timeoutMs')
    }
  })

  /**
   * TC-E02b — giá trị v1 ≥ mặc định mới được GIỮ.
   *
   * Chỉ tới được bằng sửa tay file: trần của endpoint ở v1 là 60000. Đường ĐỌC
   * file 🚫 không kẹp gì, nên con số như vậy vẫn vào tới đây — và xoá nó là vứt
   * một giá trị người dùng cố ý ghi.
   */
  test('TC-E02b: v1 với 120000 / 300000 ⇒ GIỮ nguyên', () => {
    for (const timeoutMs of [MCP_DEFAULT_TIMEOUT_MS, 300_000]) {
      writeStore({ version: 1, servers: [v1Server({ timeoutMs })] })
      expect(loadMcpServers().servers[0].timeoutMs).toBe(timeoutMs)
    }
  })

  // TC-E03
  test('TC-E03: ở v2, 15000 là lựa chọn có chủ ý ⇒ GIỮ nguyên', () => {
    writeStore({ version: MCP_SERVERS_VERSION, servers: [v1Server({ timeoutMs: 15_000 })] })

    expect(loadMcpServers().servers[0].timeoutMs).toBe(15_000)
  })

  // TC-E04
  test('TC-E04: v1 🚫 không khai timeout ⇒ 🚫 không mất gì, phiên bản báo 2', () => {
    writeStore({ version: 1, servers: [v1Server()] })

    const store = loadMcpServers()
    expect(store.version).toBe(MCP_SERVERS_VERSION)
    expect(store.servers).toHaveLength(1)
    expect(store.servers[0]).toMatchObject({ id: 'playwright', command: 'npx', enabled: true })
    expect(store.servers[0]).not.toHaveProperty('timeoutMs')
  })

  // TC-E05 — thiếu / sai kiểu / `0` đều coi như v1; bỏ qua migrate ở đó là để lọt đúng ca đang chặn.
  test('TC-E05: trường phiên bản thiếu hoặc không hợp lệ ⇒ coi như v1 và VẪN migrate', () => {
    const variants: Record<string, unknown>[] = [
      { servers: [v1Server({ timeoutMs: 15_000 })] },
      { version: 'abc', servers: [v1Server({ timeoutMs: 15_000 })] },
      { version: 0, servers: [v1Server({ timeoutMs: 15_000 })] },
      { version: null, servers: [v1Server({ timeoutMs: 15_000 })] },
    ]
    for (const data of variants) {
      writeStore(data)
      const store = loadMcpServers()
      expect(store.version).toBe(MCP_SERVERS_VERSION)
      expect(store.servers[0]).not.toHaveProperty('timeoutMs')
    }
  })

  // TC-E07
  test('TC-E07: file v1 → một thao tác lưu ⇒ file lên `version: 2`, quyền 0600, 🚫 không mất bản ghi', () => {
    writeStore({
      version: 1,
      servers: [v1Server({ timeoutMs: 15_000 }), v1Server({ id: 'serena', label: 'Serena', command: 'uvx' })],
    })

    upsertMcpServer(stdio({ id: 'them-moi', command: 'node' }))

    const parsed = JSON.parse(readStoreRaw())
    expect(parsed.version).toBe(MCP_SERVERS_VERSION)
    expect(parsed.servers.map((s: any) => s.id).sort()).toEqual(['playwright', 'serena', 'them-moi'])
    // Bản ghi đã migrate 🚫 không được ghi ngược `timeoutMs` xuống đĩa.
    expect(parsed.servers.find((s: any) => s.id === 'playwright')).not.toHaveProperty('timeoutMs')
    if (process.platform !== 'win32') {
      expect(fs.statSync(storeFile()).mode & 0o777).toBe(0o600)
    }
  })

  // TC-E08 — migrate chạy ở đường ĐỌC nên phải idempotent và 🚫 không đụng đĩa.
  test('TC-E08: đọc file v1 ba lần liên tiếp ⇒ cùng kết quả, file trên đĩa 🚫 không đổi', () => {
    const raw = JSON.stringify({ version: 1, servers: [v1Server({ timeoutMs: 15_000 })] })
    writeStore(raw)

    const reads = [loadMcpServers(), loadMcpServers(), loadMcpServers()]
    expect(reads[1]).toEqual(reads[0])
    expect(reads[2]).toEqual(reads[0])
    expect(readStoreRaw()).toBe(raw)
  })

  // TC-E09
  test('TC-E09: migrate 🚫 không đụng trường nào ngoài `timeoutMs`', () => {
    const lastCheck = { at: '2026-09-18T00:00:00.000Z', ok: true, toolCount: 21, toolNames: ['echo'] }
    writeStore({
      version: 1,
      servers: [
        v1Server({ timeoutMs: 15_000, env: { FOO: 'bar' }, cwd: '/srv/work', enabled: false, lastCheck }),
        {
          id: 'gh',
          label: 'GitHub MCP',
          enabled: true,
          transport: 'http',
          url: 'https://api.example.com/mcp',
          headers: { 'X-Trace': 'abc' },
          credentialId: 'cred-1',
          authHeader: 'Authorization',
          authScheme: 'Bearer',
          timeoutMs: 15_000,
        },
      ],
    })

    const [pw, gh] = loadMcpServers().servers as any[]
    expect(pw).toEqual({
      id: 'playwright',
      label: 'Playwright MCP',
      enabled: false,
      lastCheck,
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
      env: { FOO: 'bar' },
      cwd: '/srv/work',
    })
    expect(gh).toEqual({
      id: 'gh',
      label: 'GitHub MCP',
      enabled: true,
      lastCheck: null,
      transport: 'http',
      url: 'https://api.example.com/mcp',
      credentialId: 'cred-1',
      authHeader: 'Authorization',
      authScheme: 'Bearer',
      headers: { 'X-Trace': 'abc' },
    })
  })

  // TC-E10 — hành vi phòng thủ giữ nguyên (TC-01 / TC-02 khoá phần chung); ở đây chốt cờ version 🚫 không làm nó đổi.
  test('TC-E10: file rỗng / JSON hỏng / chưa có file ⇒ store rỗng ở v2, 🚫 không crash, 🚫 không ghi đè', () => {
    expect(loadMcpServers()).toEqual({ version: MCP_SERVERS_VERSION, servers: [] })
    expect(fs.existsSync(storeFile())).toBe(false)

    for (const raw of ['', '{', 'not json', '{"version":1}']) {
      writeStore(raw)
      expect(loadMcpServers()).toEqual({ version: MCP_SERVERS_VERSION, servers: [] })
      expect(readStoreRaw()).toBe(raw)
    }
  })

  // TC-E11
  test('TC-E11: `servers` lẫn rác ⇒ phần tử hỏng bị loại, phần tử hợp lệ vẫn migrate đúng', () => {
    writeStore({
      version: 1,
      servers: [
        null,
        'khong-phai-object',
        { label: 'thiếu id', transport: 'stdio', command: 'npx' },
        { id: 'thieu-command', transport: 'stdio' },
        v1Server({ timeoutMs: 15_000 }),
        v1Server({ id: 'giu-lai', timeoutMs: 300_000 }),
      ],
    })

    const servers = loadMcpServers().servers
    expect(servers.map((s) => s.id)).toEqual(['playwright', 'giu-lai'])
    expect(servers[0]).not.toHaveProperty('timeoutMs')
    expect(servers[1].timeoutMs).toBe(300_000)
  })
})
