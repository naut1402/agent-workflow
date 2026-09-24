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

  const server = new McpServer({ name: 'fake-mcp-server', version: '9.9.9' })
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

  await server.connect(new StdioServerTransport())
}
