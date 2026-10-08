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

if (mode === 'mcp-dump') {
  // Tf2f484e2: chép NGUYÊN VĂN file `--mcp-config` ra `MCP_CONFIG_DUMP` (env kế
  // thừa từ tiến trình cha) rồi echo argv. File bị dọn ở `finally` của job nên
  // đây là cách duy nhất đọc được nội dung nó LÚC CHẠY; 🚫 không in ra stdout vì
  // file chứa token đã giải.
  for (const a of rest) console.log(a)
  const file = mcpConfigPath()
  const dump = process.env.MCP_CONFIG_DUMP
  if (file && dump) {
    try {
      fs.writeFileSync(dump, fs.readFileSync(file, 'utf8'))
    } catch {
      /* ca âm: không có file thì dump cũng không tồn tại */
    }
  }
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
if (mode === 'mcp-split-leak') {
  // #385 TC-SEC-49: secret bị xuất làm HAI chunk rồi tiến trình thoát mã khác 0.
  // Bộ lọc mask có trạng thái giữ lại `max(len)-1` ký tự, nên phần ĐUÔI chỉ ra
  // được nếu `flushStream()` chạy ở nhánh lỗi — đó chính là thứ ca này đo.
  const file = mcpConfigPath()
  const secret = mcpConfigValues(file)[0] ?? ''
  const half = Math.ceil(secret.length / 2)
  process.stderr.write(`401 Unauthorized: Bearer ${secret.slice(0, half)}`)
  await new Promise((r) => setTimeout(r, 80))
  process.stderr.write(`${secret.slice(half)}\nDUOI-LOG-CUOI-CUNG\n`)
  await new Promise((r) => setTimeout(r, 80))
  process.exit(7)
}

if (mode === 'two-chunks') {
  // #385 TC-SEC-50: hai lần ghi tách biệt về thời gian ⇒ hai chunk `onLog` riêng.
  // Dùng để chứng minh job KHÔNG bật MCP 🚫 bị bộ lọc giữ lại/ghép lại ký tự nào.
  process.stdout.write('CHUNK-MOT\n')
  await new Promise((r) => setTimeout(r, 120))
  process.stdout.write('CHUNK-HAI\n')
  await new Promise((r) => setTimeout(r, 80))
  process.exit(0)
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
