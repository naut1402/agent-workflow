import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  MCP_TOOL_CALL_TIMEOUT_MS,
  openMcpToolBridge,
} from '../../../../../../src/features/runner/business/providers/mcpToolBridge.js'
import { upsertMcpServer } from '../../../../../../src/features/mcp/business/registry.js'
import { upsertCredential } from '../../../../../../src/features/runner/business/credentials.js'
import { openMcpSession } from '../../../../../../src/features/mcp/business/index.js'

/**
 * TC-P6-08 … TC-P6-22 + TC-P6-CRED — bridge tool MCP cho họ `ai-api` (#379, PR 4).
 *
 * Bề mặt: `openMcpToolBridge()` chạy với **MCP server THẬT** (`fake-mcp-server.mjs`
 * qua `node`). 🚫 Mock transport: ba thứ phải chứng minh — lời gọi route về đúng
 * tiến trình nào, tiến trình con có thoát không, và secret có rời hàm không —
 * đều chỉ quan sát được khi có tiến trình thật.
 */

const CANARY = 'sk-test-LEAKCANARY-0123456789'
const FIXTURE = path.join(
  import.meta.dir,
  '../../../../features/mcp/business/fake-mcp-server.mjs',
)

let home: string
let workspace: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

function seed(id: string, over: Record<string, string> = {}, mode = 'ok') {
  upsertMcpServer({
    id,
    label: id,
    enabled: true,
    transport: 'stdio',
    command: process.execPath,
    args: [FIXTURE, mode],
    env: { FAKE_MCP_SERVER_NAME: id, ...over },
  })
}

function callLogPath(): string {
  return path.join(home, 'mcp-calls.jsonl')
}
function callLog(): { server: string; tool: string; args: Record<string, unknown> }[] {
  try {
    return fs
      .readFileSync(callLogPath(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  } catch {
    return []
  }
}

function open(ids: unknown, over: Record<string, unknown> = {}) {
  return openMcpToolBridge({ ids, workspace, ...over } as any)
}

/** Tiến trình `pid` còn sống không — `kill(pid, 0)` 🚫 gửi tín hiệu nào. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitDead(pid: number, ms = 5000): Promise<boolean> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (!alive(pid)) return true
    await new Promise((r) => setTimeout(r, 25))
  }
  return !alive(pid)
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-bridge-home-'))
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-bridge-ws-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})

afterEach(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(workspace, { recursive: true, force: true })
})

describe('openMcpToolBridge — đường mặc định `null`', () => {
  test('TC-P6-01 (vế bridge): 🚫 `ids` ⇒ null, 🚫 tiến trình con nào được spawn', async () => {
    seed('on1')
    for (const ids of [undefined, null, [], 'khong-phai-mang', {}, [1, true]]) {
      expect(await open(ids)).toBeNull()
    }
  })

  test('TC-P6-15: id trỏ server 🚫 tồn tại / đang tắt ⇒ null + cảnh báo nêu từng id', async () => {
    upsertMcpServer({
      id: 'tat',
      label: 'tat',
      enabled: false,
      transport: 'stdio',
      command: process.execPath,
      args: [FIXTURE, 'ok'],
      env: {},
    })
    const warnings: string[] = []

    expect(await open(['khong-ton-tai', 'tat'], { onWarning: (m: string) => warnings.push(m) })).toBeNull()
    expect(warnings.join('\n')).toContain('khong-ton-tai')
    expect(warnings.join('\n')).toContain('tat')
  })
})

describe('openMcpToolBridge — khai tool, prefix, route', () => {
  // TC-P6-08 ⭐
  test('TC-P6-08: tên tool theo khuôn `mcp__<serverKey>__<tool>` và hợp lệ với CẢ hai SDK', async () => {
    seed('fs-local', { FAKE_MCP_TOOLS: 'read_file' })
    const bridge = (await open(['fs-local']))!
    try {
      expect(bridge.tools.map((t) => t.name)).toEqual(['mcp__fs-local__read_file'])
      for (const tool of bridge.tools) {
        // Ràng buộc tên tool chung của Anthropic + OpenAI: chỉ `[a-zA-Z0-9_-]`,
        // độ dài ≤ 64 (OpenAI chặt hơn Anthropic 128 ⇒ lấy mức chặt hơn).
        expect(tool.name).toMatch(/^[a-zA-Z0-9_-]+$/)
        expect(tool.name.length).toBeLessThanOrEqual(64)
        expect(bridge.has(tool.name)).toBe(true)
      }
    } finally {
      await bridge.close()
    }
  })

  // TC-P6-04 — schema giữ NGUYÊN VĂN của server, 🚫 dựng lại.
  test('TC-P6-04: `inputSchema` bằng đúng schema server MCP khai', async () => {
    seed('fs-local', { FAKE_MCP_TOOLS: 'read_file,ping' })
    const bridge = (await open(['fs-local']))!
    const session = await openMcpSession(
      {
        id: 'fs-local',
        label: 'fs-local',
        enabled: true,
        transport: 'stdio',
        command: process.execPath,
        args: [FIXTURE, 'ok'],
        env: { FAKE_MCP_SERVER_NAME: 'fs-local', FAKE_MCP_TOOLS: 'read_file,ping' },
      } as any,
      { cwd: workspace },
    )
    try {
      expect(bridge.tools).toHaveLength(2)
      for (const tool of bridge.tools) {
        const bare = tool.name.replace('mcp__fs-local__', '')
        const declared = session.tools.find((t) => t.name === bare)!
        expect(declared).toBeDefined()
        expect(tool.inputSchema).toEqual(declared.inputSchema)
        expect(tool.description).toBe(declared.description)
      }
      // Schema có cấu trúc thật, 🚫 phải `{}` rỗng độn vào.
      const readFile = bridge.tools.find((t) => t.name.endsWith('__read_file'))!
      expect((readFile.inputSchema as any).properties).toHaveProperty('text')
    } finally {
      await session.close()
      await bridge.close()
    }
  })

  // TC-P6-09 ⭐ — hai server cùng khai `search`.
  test('TC-P6-09: hai server cùng tool `search` ⇒ hai tên khác nhau, route về ĐÚNG server', async () => {
    seed('srv-a', { FAKE_MCP_TOOLS: 'search', FAKE_MCP_CALL_LOG: callLogPath() })
    seed('srv-b', { FAKE_MCP_TOOLS: 'search', FAKE_MCP_CALL_LOG: callLogPath() })
    const bridge = (await open(['srv-a', 'srv-b']))!
    try {
      const names = bridge.tools.map((t) => t.name).sort()
      expect(names).toEqual(['mcp__srv-a__search', 'mcp__srv-b__search'])
      expect(new Set(names).size).toBe(2)

      expect((await bridge.call('mcp__srv-b__search', { text: 'tu-b' })).ok).toBe(true)
      expect((await bridge.call('mcp__srv-a__search', { text: 'tu-a' })).ok).toBe(true)

      const log = callLog()
      expect(log).toHaveLength(2)
      // Server giả ghi nhận: lời gọi tới đúng TIẾN TRÌNH tương ứng.
      expect(log[0]).toMatchObject({ server: 'srv-b', tool: 'search', args: { text: 'tu-b' } })
      expect(log[1]).toMatchObject({ server: 'srv-a', tool: 'search', args: { text: 'tu-a' } })
    } finally {
      await bridge.close()
    }
  })

  // TC-P6-11 — tên tool GỐC (🚫 prefix) tới server, tham số nguyên vẹn.
  test('TC-P6-11: server nhận tên tool GỐC và đúng tham số; kết quả trả về thành công', async () => {
    seed('srv', { FAKE_MCP_TOOLS: 'echo', FAKE_MCP_CALL_LOG: callLogPath() })
    const bridge = (await open(['srv']))!
    try {
      const outcome = await bridge.call('mcp__srv__echo', { text: 'xin chào' })

      expect(outcome.ok).toBe(true)
      expect(JSON.stringify(outcome.result)).toContain('xin chào')
      expect(callLog()[0]).toMatchObject({ tool: 'echo', args: { text: 'xin chào' } })
      // 🚫 Bao giờ gửi tên đã prefix xuống server.
      expect(callLog()[0].tool).not.toContain('mcp__')
    } finally {
      await bridge.close()
    }
  })

  /**
   * TC-P6-10 ⭐ — server MCP khai tool TRÙNG TÊN tool sẵn có (`run_command`).
   * Vế "built-in vẫn chạy built-in" được khoá ở suite của hai provider SDK
   * (`anthropic-compatible-api.test.ts` / `openai-compatible-api.test.ts`); ở đây
   * khoá vế của bridge: nó CHỈ nhận tên đã prefix, 🚫 bao giờ nhận tên trần.
   */
  test('TC-P6-10: tool trùng tên built-in ⇒ bridge 🚫 nhận tên trần, 🚫 che tool nào', async () => {
    seed('srv', { FAKE_MCP_TOOLS: 'run_command', FAKE_MCP_CALL_LOG: callLogPath() })
    const bridge = (await open(['srv']))!
    try {
      expect(bridge.has('run_command')).toBe(false)
      expect(bridge.has('mcp__srv__run_command')).toBe(true)
      expect(bridge.tools.map((t) => t.name)).toEqual(['mcp__srv__run_command'])

      // Gọi tên trần ⇒ bridge từ chối, 🚫 route xuống server.
      const refused = await bridge.call('run_command', {})
      expect(refused.ok).toBe(false)
      expect(callLog()).toHaveLength(0)
    } finally {
      await bridge.close()
    }
  })

  // TC-P6-12
  test('TC-P6-12: gọi tool 🚫 tồn tại (có prefix MCP) ⇒ lỗi rõ ràng, 🚫 ném', async () => {
    seed('srv')
    const bridge = (await open(['srv']))!
    try {
      const outcome = await bridge.call('mcp__srv__khong-co-tool-nay', {})
      expect(outcome.ok).toBe(false)
      expect(outcome.error).toContain('khong-co-tool-nay')
      expect(outcome.result).toBeUndefined()
    } finally {
      await bridge.close()
    }
  })
})

describe('openMcpToolBridge — hỏng hóc 🚫 làm chết job', () => {
  /**
   * TC-P6-13 ⭐ — "tool trả lỗi" ở MCP là **cờ `isError` trong tool result**, 🚫
   * phải một JSON-RPC error: handler ném ở phía server vẫn trả về một result hợp
   * lệ. Nên vế đúng để khoá là *result mang cờ lỗi* + *vòng hội thoại đi tiếp*.
   * Lỗi ở tầng TRANSPORT (`outcome.ok === false`) là lớp khác, nằm ở TC-P6-12 /
   * TC-P6-16 / TC-P6-17.
   */
  test('TC-P6-13: tool trả lỗi ⇒ result mang cờ `isError`, vòng hội thoại đi tiếp', async () => {
    seed('srv', { FAKE_MCP_TOOLS: 'echo,hong', FAKE_MCP_TOOL_THROW: 'hong', FAKE_MCP_CALL_LOG: callLogPath() })
    const bridge = (await open(['srv']))!
    try {
      const bad = await bridge.call('mcp__srv__hong', { text: 'x' })
      // Bridge 🚫 ném — nó trả về cho vòng tool-use để model tự xử.
      expect(bad.ok).toBe(true)
      expect((bad.result as any)?.isError).toBe(true)
      expect(JSON.stringify(bad.result)).toContain('tool hỏng')

      // Vòng hội thoại ĐI TIẾP: lời gọi kế tiếp vẫn chạy bình thường.
      const good = await bridge.call('mcp__srv__echo', { text: 'tiep-tuc' })
      expect(good.ok).toBe(true)
      expect((good.result as any)?.isError).toBeFalsy()
      expect(JSON.stringify(good.result)).toContain('tiep-tuc')
    } finally {
      await bridge.close()
    }
  })

  // TC-P6-14 ⭐
  test('TC-P6-14: 1 trong 2 server mở hỏng ⇒ cảnh báo, tool server kia VẪN có', async () => {
    seed('tot', { FAKE_MCP_TOOLS: 'echo' })
    seed('hong', {}, 'crash')
    const warnings: string[] = []

    const bridge = (await open(['tot', 'hong'], { onWarning: (m: string) => warnings.push(m) }))!
    try {
      expect(bridge).not.toBeNull()
      expect(warnings.join('\n')).toContain('hong')
      expect(bridge.tools.map((t) => t.name)).toEqual(['mcp__tot__echo'])
      expect((await bridge.call('mcp__tot__echo', { text: 'ok' })).ok).toBe(true)
    } finally {
      await bridge.close()
    }
  }, 30_000)

  // TC-P6-15 ⭐
  test('TC-P6-15: MỌI server mở hỏng ⇒ null (quy về TC-P6-01) + cảnh báo', async () => {
    seed('hong1', {}, 'crash')
    seed('hong2', {}, 'crash')
    const warnings: string[] = []

    const bridge = await open(['hong1', 'hong2'], { onWarning: (m: string) => warnings.push(m) })

    expect(bridge).toBeNull()
    expect(warnings.filter((w) => w.includes('không mở được phiên'))).toHaveLength(2)
  }, 30_000)

  // TC-P6-16 ⭐
  test('TC-P6-16: server chết SAU `tools/list` ⇒ lời gọi trả lỗi đã xử lý, 🚫 ném', async () => {
    seed('srv', { FAKE_MCP_TOOLS: 'echo', FAKE_MCP_DIE_AFTER_LIST: '1' })
    const bridge = (await open(['srv'], { callTimeoutMs: 1500 }))!
    try {
      await new Promise((r) => setTimeout(r, 400))
      let outcome!: Awaited<ReturnType<typeof bridge.call>>
      await expect(
        (async () => {
          outcome = await bridge.call('mcp__srv__echo', { text: 'x' })
        })(),
      ).resolves.toBeUndefined()

      expect(outcome.ok).toBe(false)
      expect(String(outcome.error).length).toBeGreaterThan(0)
    } finally {
      await bridge.close()
    }
  }, 30_000)

  /**
   * TC-P6-17 ⭐ — A-5: timeout TIÊM ĐƯỢC. Ca này chạy với 300ms chứ 🚫 chờ 60s
   * thật; mặc định công khai được assert riêng để 🚫 ai hạ nó xuống rồi quên.
   */
  test('TC-P6-17: tool 🚫 bao giờ trả ⇒ lỗi timeout trong giới hạn đã khai', async () => {
    seed('srv', { FAKE_MCP_TOOLS: 'treo', FAKE_MCP_TOOL_HANG: 'treo' })
    const bridge = (await open(['srv'], { callTimeoutMs: 300 }))!
    try {
      const started = Date.now()
      const outcome = await bridge.call('mcp__srv__treo', { text: 'x' })
      const elapsed = Date.now() - started

      expect(outcome.ok).toBe(false)
      expect(outcome.error).toContain('quá hạn 300ms')
      expect(elapsed).toBeGreaterThanOrEqual(250)
      expect(elapsed).toBeLessThan(5000)
      expect(MCP_TOOL_CALL_TIMEOUT_MS).toBe(60_000)
    } finally {
      await bridge.close()
    }
  }, 30_000)
})

describe('openMcpToolBridge — vòng đời phiên', () => {
  // TC-P6-18 ⭐
  test('TC-P6-18: `close()` ⇒ tiến trình con của transport stdio ĐÃ THOÁT', async () => {
    const pidFile = path.join(home, 'child.pid')
    seed('srv', { FAKE_MCP_TOOLS: 'echo', FAKE_MCP_PID_FILE: pidFile })
    const bridge = (await open(['srv']))!

    const pid = Number(fs.readFileSync(pidFile, 'utf8'))
    expect(Number.isFinite(pid)).toBe(true)
    expect(alive(pid)).toBe(true)

    await bridge.close()
    expect(await waitDead(pid)).toBe(true)
  }, 30_000)

  /**
   * TC-P6-19 ⭐ — vòng hội thoại NÉM giữa chừng. `AgenticApiProvider` đóng bridge
   * trong `finally` của cùng khối; ca này dựng lại đúng hình dạng đó để chứng
   * minh `close()` vẫn chạy và 🚫 nuốt lỗi.
   */
  test('TC-P6-19: vòng hội thoại ném ⇒ `finally` vẫn đóng phiên, 🚫 rò tiến trình', async () => {
    const pidFile = path.join(home, 'child.pid')
    seed('srv', { FAKE_MCP_TOOLS: 'echo', FAKE_MCP_PID_FILE: pidFile })
    const bridge = (await open(['srv']))!
    const pid = Number(fs.readFileSync(pidFile, 'utf8'))

    await expect(
      (async () => {
        try {
          throw new Error('vòng hội thoại hỏng')
        } finally {
          await bridge.close()
        }
      })(),
    ).rejects.toThrow('vòng hội thoại hỏng')

    expect(await waitDead(pid)).toBe(true)
  }, 30_000)

  // TC-P6-22
  test('TC-P6-22: `close()` hai lần ⇒ idempotent; sau đó gọi tool trả lỗi, 🚫 treo', async () => {
    seed('srv', { FAKE_MCP_TOOLS: 'echo' })
    const bridge = (await open(['srv']))!

    expect((await bridge.call('mcp__srv__echo', { text: 'truoc' })).ok).toBe(true)
    await bridge.close()
    await expect(bridge.close()).resolves.toBeUndefined()

    const started = Date.now()
    const outcome = await bridge.call('mcp__srv__echo', { text: 'sau' })
    expect(outcome.ok).toBe(false)
    expect(String(outcome.error).length).toBeGreaterThan(0)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(bridge.has('mcp__srv__echo')).toBe(false)
  }, 30_000)
})

describe('openMcpToolBridge — secret 🚫 rời hàm (A-3)', () => {
  // TC-P6-20 ⭐
  test('TC-P6-20: kết quả tool CHỨA canary ⇒ outcome đã mask (đệ quy)', async () => {
    seed('srv', { FAKE_MCP_TOOLS: 'echo', FAKE_MCP_TOOL_SECRET: CANARY })
    const bridge = (await open(['srv']))!
    try {
      expect(bridge.secrets).toContain(CANARY)

      const outcome = await bridge.call('mcp__srv__echo', { text: 'noi dung' })
      expect(outcome.ok).toBe(true)
      // Quét TOÀN BỘ outcome, 🚫 chỉ một field.
      expect(JSON.stringify(outcome)).not.toContain(CANARY)
      expect(JSON.stringify(outcome)).toContain('***')
      // Phần 🚫 phải secret vẫn nguyên vẹn.
      expect(JSON.stringify(outcome)).toContain('noi dung')
    } finally {
      await bridge.close()
    }
  }, 30_000)

  // TC-P6-21
  test('TC-P6-21: thông điệp LỖI từ server chứa canary ⇒ cũng đã mask', async () => {
    seed('srv', {
      FAKE_MCP_TOOLS: 'hong',
      FAKE_MCP_TOOL_THROW: 'hong',
      FAKE_MCP_TOOL_SECRET: CANARY,
    })
    const bridge = (await open(['srv']))!
    try {
      const outcome = await bridge.call('mcp__srv__hong', { text: 'x' })

      // Thông điệp lỗi của server về dưới dạng tool result mang `isError` —
      // nó đi THẲNG tới model và vào log job, nên phải mask trước khi rời hàm.
      expect((outcome.result as any)?.isError).toBe(true)
      expect(JSON.stringify(outcome)).not.toContain(CANARY)
      expect(JSON.stringify(outcome)).toContain('***')
    } finally {
      await bridge.close()
    }
  }, 30_000)

  test('TC-P6-21 (b): cảnh báo lúc mở phiên hỏng cũng đã mask', async () => {
    const warnings: string[] = []
    seed('srv', { FAKE_MCP_REQUIRED_ENV: 'BIEN_KHONG_TON_TAI', FAKE_MCP_TOOL_SECRET: CANARY }, 'ok')

    await open(['srv'], { onWarning: (m: string) => warnings.push(m) })

    expect(warnings.join('\n')).not.toContain(CANARY)
  }, 30_000)
})

/**
 * TC-P6-CRED (review vòng 1) — remote server dùng `credentialId`. Thiếu bước
 * giải credential thì `resolveHeaders` thấy `secret` rỗng ⇒ BỎ HẲN header xác
 * thực ⇒ 401 ⇒ bridge `null` ⇒ #379 vô hiệu với đúng cấu hình mà cảnh báo
 * `argsSecretLiteral` đang khuyên dùng.
 */
describe('openMcpToolBridge — credential của server remote (TC-P6-CRED)', () => {
  test('TC-P6-CRED: credential giải được ⇒ bridge mở được và header mang secret đã giải', async () => {
    const { startFakeMcpHttp } = await import(
      '../../../../features/mcp/business/fake-mcp-http.mjs'
    )
    const srv = await startFakeMcpHttp({ mode: 'http' })
    process.env.BRIDGE_CRED_SECRET = CANARY
    try {
      upsertCredential({
        id: 'cred-mcp',
        provider: 'anthropic-api',
        label: 'MCP token',
        secretRef: 'env:BRIDGE_CRED_SECRET',
      })
      upsertMcpServer({
        id: 'rem',
        label: 'rem',
        enabled: true,
        transport: 'http',
        url: srv.url('/mcp'),
        credentialId: 'cred-mcp',
        headers: {},
      })

      const warnings: string[] = []
      const bridge = await openMcpToolBridge({
        ids: ['rem'],
        workspace,
        onWarning: (m) => warnings.push(m),
      })

      expect(bridge).not.toBeNull()
      expect(bridge!.tools.map((t) => t.name).sort()).toEqual(['mcp__rem__echo', 'mcp__rem__ping'])
      // Header xác thực ĐƯỢC GỬI THẬT, mang giá trị đã giải.
      expect(srv.hops[0]?.headers.authorization).toBe(`Bearer ${CANARY}`)
      // …và nó nằm trong danh sách mask của job.
      expect(bridge!.secrets).toContain(CANARY)
      expect(warnings.join('\n')).not.toContain('không giải được secret')

      await bridge!.close()
    } finally {
      delete process.env.BRIDGE_CRED_SECRET
      await srv.close()
    }
  }, 30_000)

  test('TC-P6-CRED (b): credential giải HỤT ⇒ cảnh báo nêu đúng nguyên nhân, 🚫 nuốt', async () => {
    const { startFakeMcpHttp } = await import(
      '../../../../features/mcp/business/fake-mcp-http.mjs'
    )
    const srv = await startFakeMcpHttp({ mode: 'http' })
    try {
      upsertMcpServer({
        id: 'rem',
        label: 'rem',
        enabled: true,
        transport: 'http',
        url: srv.url('/mcp'),
        credentialId: 'khong-ton-tai',
        headers: {},
      })

      const warnings: string[] = []
      const bridge = await openMcpToolBridge({
        ids: ['rem'],
        workspace,
        onWarning: (m) => warnings.push(m),
      })

      // Cảnh báo NGUYÊN NHÂN phải có mặt — nó phát ra TRƯỚC `connect()`.
      expect(warnings.join('\n')).toContain('không giải được secret')
      expect(warnings.join('\n')).toContain('khong-ton-tai')
      await bridge?.close()
    } finally {
      await srv.close()
    }
  }, 30_000)
})
