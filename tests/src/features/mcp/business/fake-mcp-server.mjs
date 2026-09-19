// Fake MCP server nói stdio thật (SDK `@modelcontextprotocol/sdk`) cho suite
// `client.test.ts`. Khuôn theo `tests/src/server/runners/providers/fakeCli.mjs`:
// hành vi chọn bằng argv/biến môi trường, 🚫 không gọi mạng, 🚫 không thêm
// dependency mới (SDK đã là dependency của sản phẩm).
//
//   node fake-mcp-server.mjs ok      → server MCP thật, khai 2 tool
//   node fake-mcp-server.mjs hang    → nhận stdin nhưng KHÔNG bao giờ trả lời
//   node fake-mcp-server.mjs crash   → in stderr rồi thoát mã khác 0
//
// `FAKE_MCP_PID_FILE` — ghi PID ra file để test kiểm tiến trình con đã chết
// (G9: rò tiến trình stdio sau khi probe kết thúc).
import fs from 'node:fs'

const mode = process.argv[2] || 'ok'
const pidFile = process.env.FAKE_MCP_PID_FILE
if (pidFile) fs.writeFileSync(pidFile, String(process.pid), 'utf8')

if (mode === 'crash') {
  process.stderr.write('fake-mcp: boom khi khởi động\n')
  process.exit(3)
}

if (mode === 'hang') {
  // Giữ tiến trình sống, nuốt mọi request: đúng hình dạng "server treo".
  process.stdin.resume()
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
