// Tf2f484e2 · TC-A01 … TC-A11 — tool MCP điều phối `orchestrator_decide`.
//
// Bề mặt quan sát là phiên MCP client ↔ server: `tools/list`, `initialize`
// (`instructions`), và envelope của `tools/call`. Lớp HTTP tới dashboard được
// giả lập ở mức `fetch` — 🚫 không dựng server thật ở đây (ca chạm thật là
// TC-D07 ở `selfMcpSpawn.test.ts`).
//
// ⚠️ Tool này là lớp vỏ mỏng quanh `POST /api/orchestrator/decide`. Mọi giá trị
// mong đợi về mã trạng thái / tên trường dưới đây lấy từ hợp đồng ĐÃ ĐỐI CHIẾU
// với `src/features/orchestrator/controller.ts` (implement.md §1), 🚫 không lấy
// từ bảng trong `design.md`.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { DashboardMcpServer } from '../../mcp/DashboardMcpServer'
import { OrchestratorTools } from '../../mcp/tools/OrchestratorTools'
import type { McpErrorCode } from '../../mcp/AbstractMcpTools'

const tools = new OrchestratorTools(DashboardMcpServer.resolveRoot)

const BASE_URL = 'http://127.0.0.1:59123'
const TOKEN = 'orch-token-abc-123'

const REPO_ROOT = path.resolve(import.meta.dir, '..', '..')

// ── Cô lập env ────────────────────────────────────────────────────────────────
//
// Hai biến này là thứ phân biệt "tiến trình gắn với một lượt điều phối" với
// "tiến trình MCP thường" (TC-A04). Máy dev/CI có sẵn giá trị nào là ca âm xanh
// giả, nên phải tước sạch rồi tự đặt.

const ISOLATED = ['DASHBOARD_ORCHESTRATOR_TOKEN', 'DASHBOARD_ORCHESTRATOR_BASE_URL'] as const
const saved: Record<string, string | undefined> = {}
const realFetch = globalThis.fetch

/** Lời gọi `fetch` đã phát đi — đếm được, nên "🚫 không gọi HTTP" assert được. */
interface Sent {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}
let sent: Sent[] = []

/** Thay `fetch` bằng một dashboard giả lập. `reply` nhận request, trả Response. */
function stubFetch(reply: (sent: Sent, init: RequestInit) => Promise<Response> | Response) {
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries((init.headers ?? {}) as Record<string, string>)) {
      headers[k.toLowerCase()] = v
    }
    const record: Sent = {
      url: String(input),
      method: String(init.method ?? 'GET'),
      headers,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    }
    sent.push(record)
    return reply(record, init)
  }) as typeof fetch
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  sent = []
  for (const key of ISOLATED) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  globalThis.fetch = realFetch
  for (const key of ISOLATED) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

/** Env của một tiến trình MCP ĐANG gắn với một lượt điều phối. */
function withOrchestratorEnv() {
  process.env.DASHBOARD_ORCHESTRATOR_TOKEN = TOKEN
  process.env.DASHBOARD_ORCHESTRATOR_BASE_URL = BASE_URL
}

const codeOf = (r: any): McpErrorCode | undefined => r?._meta?.error?.code
const textOf = (r: any): string => String(r?.content?.[0]?.text ?? '')

// ═══ TC-A01 · hợp đồng khai báo của tool ══════════════════════════════════════

describe('TC-A01: tool có mặt ở mode ghi, schema nhận đủ bộ trường quyết định', () => {
  test('định nghĩa tool — tên, quyền, input schema, output schema, annotations', () => {
    const defs = tools.definitions()
    expect(defs.map((d) => d.name)).toEqual(['orchestrator_decide'])

    const def = defs[0]
    expect(def.access).toBe('write')
    // 5 action của `OrchestratorDecision` — template agent liệt kê đúng tập này
    // (TC-E02), nên lệch ở đây là agent không bao giờ dùng được action thiếu.
    const actions = (def.config.inputSchema.action as any)._def.values ?? (def.config.inputSchema.action as any).options
    expect([...actions].sort()).toEqual(['halt', 'respawn', 'resume', 'start', 'summary'])
    expect(Object.keys(def.config.inputSchema).sort()).toEqual(
      ['action', 'context', 'message', 'reason', 'stepId', 'summary'].sort(),
    )
    // 🚫 Không nhận `taskId`/`project`: task đến từ token của lượt, không từ tham số.
    expect(Object.keys(def.config.inputSchema)).not.toContain('taskId')
    expect(Object.keys(def.config.inputSchema)).not.toContain('project')

    expect(Object.keys(def.config.outputSchema ?? {})).toEqual(['applied'])
    expect(def.config.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    })
  })

  test('`tools/list` qua client thật ở mode full phơi đúng tool đó', async () => {
    const list = await toolsOf('full')
    const tool = list.find((t) => t.name === 'orchestrator_decide')!
    expect(tool).toBeTruthy()
    expect(tool.inputSchema.type).toBe('object')
    expect(tool.inputSchema.required).toEqual(['action'])
    expect(tool.inputSchema.properties.action.enum.sort()).toEqual(
      ['halt', 'respawn', 'resume', 'start', 'summary'],
    )
    for (const field of ['stepId', 'reason', 'message', 'summary', 'context']) {
      expect(tool.inputSchema.properties).toHaveProperty(field)
    }
  })
})

async function toolsOf(mode: 'readonly' | 'full'): Promise<any[]> {
  const server = new DashboardMcpServer(mode).build()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'orch-tool-test', version: '1.0.0' })
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
  try {
    return (await client.listTools()).tools
  } finally {
    await client.close()
    await server.close()
  }
}

// ═══ TC-A02 / TC-A03 · mode và instructions ═══════════════════════════════════

describe('TC-A02: tool vắng ở mode đọc', () => {
  test('`tools/list` ở readonly 🚫 không có orchestrator_decide', async () => {
    const names = (await toolsOf('readonly')).map((t) => t.name)
    expect(names).not.toContain('orchestrator_decide')
  })
})

describe('TC-A03: instructions của initialize chỉ đúng đường theo mode', () => {
  test('full dạy gọi tool; readonly dạy in dòng cuối output', async () => {
    const instructionsOf = async (mode: 'readonly' | 'full') => {
      const server = new DashboardMcpServer(mode).build()
      const [ct, st] = InMemoryTransport.createLinkedPair()
      const client = new Client({ name: 'orch-instr-test', version: '1.0.0' })
      await Promise.all([client.connect(ct), server.connect(st)])
      try {
        return String(client.getInstructions() ?? '')
      } finally {
        await client.close()
        await server.close()
      }
    }

    const full = await instructionsOf('full')
    expect(full).toContain('`orchestrator_decide` — ra lệnh điều phối')
    expect(full).not.toContain('`orchestrator_decide` KHÔNG có ở mode')

    const readonly = await instructionsOf('readonly')
    expect(readonly).toContain('`orchestrator_decide` KHÔNG có ở mode `readonly`')
    expect(readonly).toContain('ORCHESTRATOR_DECISION')
  })
})

// ═══ TC-A04 … TC-A09 · hành vi handler ════════════════════════════════════════

describe('TC-A04: tiến trình MCP không gắn với lượt điều phối nào', () => {
  test('thiếu env ⇒ isError + mã lỗi + nêu lối thoát sentinel, 🚫 không gọi HTTP', async () => {
    stubFetch(() => jsonResponse(200, { applied: 'start' }))

    for (const env of [
      {},
      { DASHBOARD_ORCHESTRATOR_TOKEN: TOKEN },
      { DASHBOARD_ORCHESTRATOR_BASE_URL: BASE_URL },
    ]) {
      for (const key of ISOLATED) delete process.env[key]
      Object.assign(process.env, env)

      const res = await tools.decide({ action: 'start', stepId: 'implementer' })
      expect(res.isError).toBe(true)
      expect(codeOf(res)).toBeTruthy()
      // Lối thoát phải NÊU RÕ, không chỉ "lỗi": agent đọc message này để biết
      // phải in dòng cuối output thay vì bỏ cuộc.
      expect(textOf(res)).toContain('ORCHESTRATOR_DECISION')
    }
    // Không có env thì 🚫 không được đoán base-url và bắn đi đâu cả.
    expect(sent).toHaveLength(0)
  })
})

describe('TC-A05: quyết định hợp lệ được chuyển đúng tới dashboard', () => {
  test('đúng MỘT POST tới /api/orchestrator/decide, đúng header token, đúng body', async () => {
    withOrchestratorEnv()
    stubFetch(() => jsonResponse(200, { applied: 'resume' }))

    const args = { action: 'resume', stepId: 'implementer', message: 'sửa 2 điểm', reason: 'review NG' }
    const res = await tools.decide(args)

    expect(sent).toHaveLength(1)
    expect(sent[0].url).toBe(`${BASE_URL}/api/orchestrator/decide`)
    expect(sent[0].method).toBe('POST')
    expect(sent[0].headers['x-dashboard-orchestrator-token']).toBe(TOKEN)
    expect(sent[0].headers['content-type']).toBe('application/json')
    expect(sent[0].body).toEqual(args)

    // Envelope thành công: `content[0].text` parse được VÀ `structuredContent`
    // song song (hợp đồng §5.1 của docs/mcp/server.md).
    expect(res.isError).toBeFalsy()
    expect(JSON.parse(textOf(res))).toEqual({ applied: 'resume' })
    expect(res.structuredContent).toEqual({ applied: 'resume' })
  })
})

describe('TC-A06: quyết định vi phạm ràng buộc liên-trường', () => {
  test('dashboard trả 400 ⇒ invalid_input + NGUYÊN VĂN lý do để agent sửa và gọi lại', async () => {
    withOrchestratorEnv()
    stubFetch(() => jsonResponse(400, { error: 'unknown stepId: khong-co' }))

    const res = await tools.decide({ action: 'start', stepId: 'khong-co' })

    expect(res.isError).toBe(true)
    expect(codeOf(res)).toBe('invalid_input')
    expect(textOf(res)).toBe('unknown stepId: khong-co')
    // Nhánh lỗi 🚫 KHÔNG mang `structuredContent` — đó là ngòi nổ McpError -32602.
    expect(res.structuredContent).toBeUndefined()
  })

  test('400 không kèm `error` đọc được ⇒ vẫn invalid_input, message không rỗng', async () => {
    withOrchestratorEnv()
    stubFetch(() => new Response('<html>', { status: 400 }))

    const res = await tools.decide({ action: 'start' })
    expect(codeOf(res)).toBe('invalid_input')
    expect(textOf(res).length).toBeGreaterThan(0)
  })
})

describe('TC-A07: token đã bị thu hồi / hết hạn', () => {
  test('401 ⇒ isError, mã PHÂN BIỆT được với lỗi input, 🚫 không retry', async () => {
    withOrchestratorEnv()
    stubFetch(() => jsonResponse(401, { error: 'invalid or expired orchestrator token' }))

    const res = await tools.decide({ action: 'halt', reason: 'xong' })

    expect(res.isError).toBe(true)
    expect(codeOf(res)).toBe('internal')
    expect(codeOf(res)).not.toBe('invalid_input')
    expect(textOf(res)).toContain('ORCHESTRATOR_DECISION')
    // 🚫 Không retry tự động: đúng MỘT request đi ra.
    expect(sent).toHaveLength(1)
  })

  test('mã lạ (500) cũng không biến thành thành công', async () => {
    withOrchestratorEnv()
    stubFetch(() => jsonResponse(500, { error: 'boom' }))

    const res = await tools.decide({ action: 'summary' })
    expect(res.isError).toBe(true)
    expect(codeOf(res)).toBe('internal')
    expect(textOf(res)).toContain('500')
    expect(sent).toHaveLength(1)
  })
})

describe('TC-A08: không gọi được dashboard', () => {
  test('fetch ném ⇒ isError kèm nguyên nhân; handler 🚫 không ném ra ngoài', async () => {
    withOrchestratorEnv()
    stubFetch(() => {
      throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:59123'), { code: 'ECONNREFUSED' })
    })

    const res = await tools.decide({ action: 'halt' })
    expect(res.isError).toBe(true)
    expect(codeOf(res)).toBe('internal')
    expect(textOf(res)).toContain('ECONNREFUSED')
  })

  test('phiên còn sống: lượt gọi KẾ TIẾP trong cùng phiên vẫn thành công', async () => {
    withOrchestratorEnv()
    let first = true
    stubFetch(() => {
      if (first) {
        first = false
        throw new Error('getaddrinfo ENOTFOUND dashboard')
      }
      return jsonResponse(200, { applied: 'halt' })
    })

    expect((await tools.decide({ action: 'halt' })).isError).toBe(true)
    const second = await tools.decide({ action: 'halt' })
    expect(second.isError).toBeFalsy()
    expect(second.structuredContent).toEqual({ applied: 'halt' })
  })
})

describe('TC-A09: dashboard treo, không bao giờ trả lời', () => {
  /**
   * ⚠️ Ca này CỐ Ý chạy thật tới mốc timeout (~15s): bất biến được chốt là "có
   * một thời hạn hữu hạn", mà một mốc hữu hạn thì không chứng minh được bằng
   * cách rút ngắn nó. CLI chờ tool, tool chờ dashboard — thiếu mốc này một
   * dashboard treo làm cả lượt điều phối treo theo.
   *
   * `fetch` giả lập hành xử đúng như `fetch` thật: không bao giờ hồi đáp, chỉ
   * reject khi `signal` mà handler truyền vào bị abort.
   */
  test('tool trả isError trong thời hạn hữu hạn, 🚫 không chờ vô hạn', async () => {
    withOrchestratorEnv()
    let seenSignal: AbortSignal | null = null
    stubFetch((_record, init) => {
      const signal = init.signal as AbortSignal
      seenSignal = signal
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' })),
        )
      })
    })

    const started = Date.now()
    const res = await tools.decide({ action: 'summary' })
    const elapsed = Date.now() - started

    // Handler PHẢI truyền signal, nếu không mốc timeout là hư cấu.
    expect(seenSignal).toBeInstanceOf(AbortSignal)
    expect(res.isError).toBe(true)
    expect(codeOf(res)).toBe('internal')
    expect(textOf(res)).toContain('ORCHESTRATOR_DECISION')
    // Đã THẬT SỰ chờ (không phải trả lỗi ngay vì lý do khác) và đã dừng lại.
    expect(elapsed).toBeGreaterThan(1_000)
    expect(elapsed).toBeLessThan(30_000)
  }, 45_000)
})

// ═══ TC-A10 · hợp đồng outputSchema nhìn từ client SDK thật ═══════════════════

describe('TC-A10: envelope đi qua validator của client SDK', () => {
  /**
   * 🔴 Tool khai `outputSchema` mà thiếu `structuredContent` ở nhánh thành công
   * là `McpError -32602` RUNTIME, và nó CHỈ lộ ở phía client sau khi client đã
   * gọi `tools/list` (validator nạp từ đó). Gọi thẳng handler không bao giờ bắt
   * được — vì thế `listTools()` dưới đây là BẮT BUỘC.
   */
  test('thành công và thất bại đều trả CallToolResult đọc được, 🚫 không lượt nào ném', async () => {
    withOrchestratorEnv()
    stubFetch((record) =>
      (record.body as any)?.stepId === 'implementer'
        ? jsonResponse(200, { applied: 'start' })
        : jsonResponse(400, { error: 'unknown stepId: khong-co' }),
    )

    const server = new DashboardMcpServer('full').build()
    const [ct, st] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'orch-sdk-test', version: '1.0.0' })
    await Promise.all([client.connect(ct), server.connect(st)])
    try {
      await client.listTools()

      const call = async (args: Record<string, unknown>) => {
        try {
          return (await client.callTool({ name: 'orchestrator_decide', arguments: args })) as any
        } catch (err: any) {
          throw new Error(
            `orchestrator_decide ném thay vì trả CallToolResult: ${err?.code} ${err?.message}`,
            { cause: err },
          )
        }
      }

      const ok = await call({ action: 'start', stepId: 'implementer' })
      expect(ok.isError).toBeFalsy()
      expect(ok.structuredContent).toEqual({ applied: 'start' })
      expect(JSON.parse(String(ok.content[0].text))).toEqual({ applied: 'start' })

      const bad = await call({ action: 'start', stepId: 'khong-co' })
      expect(bad.isError).toBe(true)
      expect(bad._meta?.error?.code).toBe('invalid_input')
      expect(bad.structuredContent).toBeUndefined()
    } finally {
      await client.close()
      await server.close()
    }
  }, 20_000)
})

// ═══ TC-A11 · mã lỗi phát ra khớp tài liệu ════════════════════════════════════

describe('TC-A11: mọi mã lỗi phát ra nằm trong McpErrorCode VÀ được tài liệu khai', () => {
  test('gom mã của A04/A06/A07/A08 rồi đối chiếu docs/mcp/server.md §5.2', async () => {
    const VALID: McpErrorCode[] = ['not_found', 'invalid_input', 'forbidden_in_mode', 'internal']
    const codes = new Set<string>()

    // A04 — thiếu env
    stubFetch(() => jsonResponse(200, {}))
    codes.add(String(codeOf(await tools.decide({ action: 'halt' }))))

    withOrchestratorEnv()
    // A06 — 400
    stubFetch(() => jsonResponse(400, { error: 'malformed decision' }))
    codes.add(String(codeOf(await tools.decide({ action: 'start' }))))
    // A07 — 401
    stubFetch(() => jsonResponse(401, { error: 'invalid token' }))
    codes.add(String(codeOf(await tools.decide({ action: 'halt' }))))
    // A08 — fetch ném
    stubFetch(() => {
      throw new Error('ECONNREFUSED')
    })
    codes.add(String(codeOf(await tools.decide({ action: 'halt' }))))

    for (const code of codes) expect(VALID).toContain(code as McpErrorCode)
    expect([...codes].sort()).toEqual(['internal', 'invalid_input'])

    // ⚠️ `internal` nằm NGOÀI tập `not_found`/`invalid_input` của 1.2.0 trước
    // thay đổi này, nên bảng "mã thực sự phát ra" phải được cập nhật trong CÙNG
    // thay đổi — đúng điểm test-spec §5.2 bắt. Đây là chỗ kiểm điều đó.
    const doc = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'mcp', 'server.md'), 'utf8')
    const emitted = doc.slice(doc.indexOf('Mã lỗi **thực sự phát ra**'), doc.indexOf('### 5.3'))
    expect(emitted).toContain('| `internal` |')
    expect(emitted).toContain('orchestrator_decide')
    // Và câu "chưa nơi nào phát ra" không được còn nói về `internal`.
    const leftover = doc.slice(doc.indexOf('mã dự phòng chưa nơi nào phát ra'), doc.indexOf('### 5.3'))
    expect(leftover).toContain('forbidden_in_mode')
    expect(leftover).not.toContain('`internal`')
  })
})
