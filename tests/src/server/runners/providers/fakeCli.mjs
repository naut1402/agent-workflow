// Cross-platform fake CLI for provider spawn tests (node echo-args | ok | fail).
// Các mode `mcp-*` được THÊM cho suite MCP (T8b1aa18e) — 🚫 không sửa mode sẵn có.
import fs from 'node:fs'

const mode = process.argv[2] || 'echo-args'
const rest = process.argv.slice(3)

/** Đường dẫn ngay sau cờ `--mcp-config` trong argv, hoặc null. */
function mcpConfigPath() {
  const i = rest.indexOf('--mcp-config')
  return i >= 0 ? rest[i + 1] ?? null : null
}

/** Mọi giá trị `env`/`headers` trong file config — thứ một MCP server có thể in ra. */
function mcpConfigValues(file) {
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Object.values(json.mcpServers ?? {}).flatMap((entry) =>
      Object.values(entry.env ?? entry.headers ?? {}),
    )
  } catch {
    return []
  }
}

if (mode === 'mcp-echo') {
  // Argv thật mà provider truyền cho tiến trình con + file config có tồn tại
  // LÚC CHẠY hay không (bất biến "sinh khi chạy, xoá sau khi xong").
  for (const a of rest) console.log(a)
  const file = mcpConfigPath()
  console.log(`mcp-config-exists=${file ? fs.existsSync(file) : 'none'}`)
  process.exit(0)
}

if (mode === 'mcp-leak') {
  // MCP server (hoặc chính CLI) in token ra stderr rồi hỏng — đúng hình dạng
  // `401 Unauthorized: Bearer sk-…` mà bộ lọc log phải chặn.
  const file = mcpConfigPath()
  for (const value of mcpConfigValues(file)) {
    process.stderr.write(`401 Unauthorized: Bearer ${value}\n`)
  }
  process.exit(7)
}
if (mode === 'ok') {
  console.log('ok')
  process.exit(0)
}
if (mode === 'hello') {
  console.log('hello from runner')
  process.exit(0)
}
if (mode === 'fail') {
  console.error('boom')
  process.exit(1)
}
if (mode === 'hang') {
  console.log('Execution error')
  setInterval(() => {}, 1000)
} else if (mode === 'echo-args') {
  for (const a of rest) console.log(a)
  process.exit(0)
} else {
  process.exit(2)
}
