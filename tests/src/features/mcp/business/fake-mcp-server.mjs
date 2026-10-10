// Fake MCP server nói stdio thật (SDK `@modelcontextprotocol/sdk`) cho suite
// `client.test.ts`. Khuôn theo `tests/src/server/runners/providers/fakeCli.mjs`:
// hành vi chọn bằng argv/biến môi trường, 🚫 không gọi mạng, 🚫 không thêm
// dependency mới (SDK đã là dependency của sản phẩm).
//
//   node fake-mcp-server.mjs ok              → server MCP thật, khai 2 tool
//   node fake-mcp-server.mjs hang            → nhận stdin nhưng KHÔNG bao giờ trả lời
//   node fake-mcp-server.mjs crash           → in stderr rồi thoát mã khác 0
//   node fake-mcp-server.mjs init-then-hang  → trả lời `initialize` rồi im lặng
//
// Biến môi trường (áp dụng cho mọi mode trừ `crash`):
//   FAKE_MCP_PID_FILE      — ghi PID ra file để test kiểm tiến trình con đã chết
//                            (G9: rò tiến trình stdio sau khi probe kết thúc).
//   FAKE_MCP_ENV_FILE      — ghi `{ env, cwd }` của tiến trình con ra file JSON.
//                            Đây là cách duy nhất quan sát được env và cwd mà probe
//                            thật sự truyền xuống (nhóm D của Tdad47b2b). `cwd` phải
//                            lấy từ `process.cwd()`: biến `PWD` được kế thừa từ tiến
//                            trình cha nên nó KHÔNG phản ánh cwd thật của con.
//   FAKE_MCP_REQUIRED_ENV  — tên biến BẮT BUỘC phải có; thiếu ⇒ thoát mã 4. Dựng
//                            lại đúng hình dạng «server phụ thuộc một biến ngoài
//                            danh sách hẹp cũ» của bug gốc.
//   FAKE_MCP_DELAY_MS      — trễ trước khi phục vụ, mô phỏng server khởi động chậm.
import fs from 'node:fs'

const mode = process.argv[2] || 'ok'
const pidFile = process.env.FAKE_MCP_PID_FILE
if (pidFile) fs.writeFileSync(pidFile, String(process.pid), 'utf8')

if (mode === 'crash') {
  process.stderr.write('fake-mcp: boom khi khởi động\n')
  process.exit(3)
}

const envFile = process.env.FAKE_MCP_ENV_FILE
if (envFile) {
  fs.writeFileSync(envFile, JSON.stringify({ env: process.env, cwd: process.cwd() }), 'utf8')
}

const required = process.env.FAKE_MCP_REQUIRED_ENV
if (required && process.env[required] === undefined) {
  process.stderr.write(`fake-mcp: thiếu biến môi trường bắt buộc ${required}\n`)
  process.exit(4)
}

const delayMs = Number(process.env.FAKE_MCP_DELAY_MS || 0)
if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))

if (mode === 'hang') {
  // Giữ tiến trình sống, nuốt mọi request: đúng hình dạng "server treo".
  process.stdin.resume()
  setInterval(() => {}, 1000)
} else if (mode === 'init-then-hang') {
  // JSON-RPC thô, 🚫 không qua SDK: cần bắt tay XONG rồi mới treo, mà SDK
  // không có đường tắt để chỉ treo một method. Dùng để đo rằng `timeoutMs` là
  // NGÂN SÁCH TỔNG — `connect` và `tools/list` chia chung một deadline.
  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buffer += chunk
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      index = buffer.indexOf('\n')
      if (!line) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      // Chỉ trả lời `initialize`; mọi method khác (kể cả `tools/list`) bị nuốt.
      if (msg.method !== 'initialize' || msg.id === undefined) continue
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: msg.params?.protocolVersion || '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'fake-mcp-server', version: '9.9.9' },
          },
        })}\n`,
      )
    }
  })
  setInterval(() => {}, 1000)
} else {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')
  const { z } = await import('zod')

  // ── Mở rộng cho #379 (bridge tool MCP). Mọi thứ dưới đây đều OPT-IN qua env:
  // 🚫 đặt biến nào thì server khai đúng `echo` + `ping` như trước, 🚫 đổi một
  // byte hành vi của các suite đang dùng mode `ok`.
  //
  //   FAKE_MCP_TOOLS        — danh sách tool, phân tách bằng dấu phẩy (mặc định `echo,ping`)
  //   FAKE_MCP_TOOL_ERROR   — tên tool trả `isError: true`
  //   FAKE_MCP_TOOL_HANG    — tên tool KHÔNG BAO GIỜ trả lời (đo timeout)
  //   FAKE_MCP_TOOL_SECRET  — chuỗi mà mọi tool vọng lại trong kết quả (đo mask)
  //   FAKE_MCP_TOOL_THROW   — tên tool ném lỗi mang `FAKE_MCP_TOOL_SECRET`
  //   FAKE_MCP_CALL_LOG     — file JSONL ghi `{ server, tool, args }` mỗi lời gọi
  //                           (bằng chứng DUY NHẤT cho "route về ĐÚNG server")
  //   FAKE_MCP_SERVER_NAME  — tên server, để phân biệt hai tiến trình trong call log
  //   FAKE_MCP_DIE_AFTER_LIST — thoát NGAY sau `tools/list` (server chết giữa vòng tool-use)
  const serverName = process.env.FAKE_MCP_SERVER_NAME || 'fake-mcp-server'
  const toolNames = (process.env.FAKE_MCP_TOOLS || 'echo,ping')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  const errorTool = process.env.FAKE_MCP_TOOL_ERROR || ''
  const hangTool = process.env.FAKE_MCP_TOOL_HANG || ''
  const throwTool = process.env.FAKE_MCP_TOOL_THROW || ''
  const secret = process.env.FAKE_MCP_TOOL_SECRET || ''
  const callLog = process.env.FAKE_MCP_CALL_LOG || ''

  // `FAKE_MCP_TOOLS=' '` ⇒ 0 tool. Phải KHAI capability `tools` tường minh, nếu
  // không `McpServer` chỉ bật capability khi có tool đầu tiên và `tools/list` trả
  // lỗi "server does not support tools" — đó là ca KHÁC (TC-P6-14/15), 🚫 phải
  // "server khai 0 tool" của TC-P6-07.
  const server = new McpServer({ name: serverName, version: '9.9.9' }, { capabilities: { tools: {} } })
  for (const name of toolNames) {
    server.registerTool(
      name,
      {
        description: name === 'ping' ? 'Trả lại pong' : `Tool ${name} của ${serverName}`,
        inputSchema: name === 'ping' ? {} : { text: z.string() },
      },
      async (args) => {
        if (callLog) {
          fs.appendFileSync(callLog, `${JSON.stringify({ server: serverName, tool: name, args })}\n`)
        }
        if (name === hangTool) await new Promise(() => {})
        if (name === throwTool) throw new Error(`fake-mcp: tool hỏng ${secret}`)
        if (name === errorTool) {
          return { isError: true, content: [{ type: 'text', text: `fake-mcp: lỗi tool ${secret}` }] }
        }
        const body = name === 'ping' ? 'pong' : String(args?.text ?? '')
        return { content: [{ type: 'text', text: secret ? `${body} ${secret}` : body }] }
      },
    )
  }

  // 0 tool: `McpServer` chỉ ĐĂNG KÝ handler `tools/list` khi có tool đầu tiên,
  // nên khai capability thôi 🚫 đủ — `tools/list` trả `Method not found`. Đăng ký
  // một tool rồi gỡ ngay: handler ở lại, danh sách rỗng. Đó mới đúng hình dạng
  // "server CÓ hỗ trợ tool nhưng 🚫 khai cái nào" của TC-P6-07.
  if (!toolNames.length) {
    const tmp = server.registerTool('__tam__', { description: 'tạm', inputSchema: {} }, async () => ({
      content: [{ type: 'text', text: '' }],
    }))
    tmp.remove()
  }

  await server.connect(new StdioServerTransport())

  if (process.env.FAKE_MCP_DIE_AFTER_LIST) {
    // Chết NGAY sau khi trả `tools/list`: bridge đã có tool trong tay, lời gọi
    // sau đó phải trả lỗi ĐÃ XỬ LÝ chứ 🚫 ném ra ngoài vòng tool-use.
    process.stdin.on('data', (chunk) => {
      if (String(chunk).includes('tools/list')) setTimeout(() => process.exit(9), 50)
    })
  }
}
