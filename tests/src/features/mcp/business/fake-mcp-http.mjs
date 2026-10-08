// Fake MCP server nói **HTTP thật** (streamable-http + SSE) cho nhóm A của #385.
//
// Vì sao thêm file thay vì mở rộng `fake-mcp-server.mjs`: file đó là một tiến
// trình **stdio** chọn chế độ bằng argv. Nhóm A cần (a) nhiều server cùng lúc để
// dựng redirect đổi origin, (b) đọc lại header/body **từng hop** ngay trong
// test. Hai thứ đó muốn một module in-process, 🚫 không phải một tiến trình con.
// `test-spec.md` A-7 cho phép đúng việc này, và file nằm trong CÙNG thư mục đã
// khai ở `tests/runners.json` ⇒ 🚫 không phải sửa `runners.json`.
//
//   const srv = await startFakeMcpHttp({ mode: 'http' })
//   srv.plan = () => ({ status: 302, location: 'http://example.com/mcp' })
//   srv.hops            // [{ method, path, headers, body }] — MỌI request đã tới
//   await srv.close()
//
// 🚫 Không gọi mạng ra ngoài: luôn bind `127.0.0.1` ở cổng 0 (ephemeral).
import http from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

export const SSE_POST_PATH = '/sse-messages'

function buildMcpServer() {
  const server = new McpServer({ name: 'fake-mcp-http', version: '9.9.9' })
  server.registerTool(
    'echo',
    { description: 'Trả lại chuỗi đã nhận', inputSchema: { text: z.string() } },
    async ({ text }) => ({ content: [{ type: 'text', text }] }),
  )
  server.registerTool(
    'ping',
    { description: 'Trả lại pong', inputSchema: {} },
    async () => ({ content: [{ type: 'text', text: 'pong' }] }),
  )
  return server
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (c) => {
      raw += c
    })
    req.on('end', () => resolve(raw))
    req.on('error', () => resolve(raw))
  })
}

/**
 * @param {{ mode?: 'http' | 'sse', plan?: (ctx) => ({ status: number, location?: string } | null) }} opts
 *   `plan` trả `null` ⇒ phục vụ MCP thật. Trả `{ status, location }` ⇒ đáp 3xx.
 *   Bỏ `location` ⇒ 3xx **thiếu** header `Location` (TC-SEC-09).
 */
export async function startFakeMcpHttp(opts = {}) {
  const mode = opts.mode === 'sse' ? 'sse' : 'http'
  /** @type {{ method: string, path: string, headers: Record<string,string>, body: string }[]} */
  const hops = []
  const sseTransports = new Map()
  /** Số message server đã đẩy xuống stream SSE — TC-SEC-06 đếm cái này. */
  let sseMessages = 0
  const state = { plan: opts.plan ?? null }

  const server = http.createServer(async (req, res) => {
    const index = hops.length
    const body = await readBody(req)
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
    hops.push({ method: req.method ?? '', path: req.url ?? '', headers: { ...req.headers }, body })

    const decision = state.plan
      ? state.plan({ index, method: req.method, path: req.url, pathname: url.pathname, url, body })
      : null
    if (decision) {
      const headers = {}
      if (decision.location !== undefined) headers.location = decision.location
      res.writeHead(decision.status, headers)
      res.end()
      return
    }

    try {
      if (mode === 'sse') {
        if (req.method === 'GET') {
          const transport = new SSEServerTransport(SSE_POST_PATH, res)
          // Đếm message đẩy xuống stream để TC-SEC-06 chứng minh stream 🚫 đứt.
          const originalSend = transport.send.bind(transport)
          transport.send = async (message, options) => {
            sseMessages += 1
            return originalSend(message, options)
          }
          sseTransports.set(transport.sessionId, transport)
          res.on('close', () => sseTransports.delete(transport.sessionId))
          await buildMcpServer().connect(transport)
          return
        }
        if (req.method === 'POST') {
          const sessionId = url.searchParams.get('sessionId') ?? ''
          const transport = sseTransports.get(sessionId)
          if (!transport) {
            res.writeHead(404).end()
            return
          }
          await transport.handlePostMessage(req, res, body ? JSON.parse(body) : undefined)
          return
        }
        res.writeHead(405).end()
        return
      }

      if (req.method === 'POST') {
        // Stateless: một McpServer + transport cho mỗi request. Đủ cho probe
        // (initialize → tools/list) và 🚫 không phải quản phiên trong fixture.
        const mcp = buildMcpServer()
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
        res.on('close', () => {
          transport.close().catch(() => {})
          mcp.close().catch(() => {})
        })
        await mcp.connect(transport)
        await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined)
        return
      }
      // GET/DELETE của streamable-http là tuỳ chọn — 405 là đáp hợp lệ.
      res.writeHead(405).end()
    } catch (err) {
      if (!res.headersSent) res.writeHead(500)
      res.end(String(err?.message ?? err))
    }
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const origin = `http://127.0.0.1:${port}`

  return {
    port,
    origin,
    hops,
    mode,
    url: (p = mode === 'sse' ? '/sse' : '/mcp') => `${origin}${p}`,
    get sseMessages() {
      return sseMessages
    },
    set plan(fn) {
      state.plan = fn
    },
    get plan() {
      return state.plan
    },
    /** Mọi giá trị header của mọi hop, nối lại — dùng để quét canary. */
    headerDump: () => JSON.stringify(hops.map((h) => h.headers)),
    async close() {
      for (const t of sseTransports.values()) await t.close().catch(() => {})
      sseTransports.clear()
      await new Promise((resolve) => server.close(resolve))
      // `server.close()` chờ keep-alive; cắt hẳn để test 🚫 treo.
      server.closeAllConnections?.()
    },
  }
}
