import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  deleteMcpServer,
  listMcpServers,
  recordCheckResult,
  upsertMcpServer,
} from '../../../../../src/features/mcp/business/registry.js'
import {
  MCP_MASK,
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
