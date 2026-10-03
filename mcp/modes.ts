// Mode vận hành của MCP server (vai inbound).
//
// Mode cố định lúc spawn và quyết định TOOL NÀO ĐƯỢC ĐĂNG KÝ (D3) — không phải
// một lớp chặn lúc gọi. Tool ngoài allowlist biến hẳn khỏi `tools/list`, nên
// agent không thấy thì không thử, không tiêu token, và bề mặt tấn công thu nhỏ
// thật chứ không chỉ bị từ chối.
//
// Mặc định là `readonly` (D7): an toàn theo mặc định, bật `full` chủ động qua
// `mcpServers.env` của client.

export const MCP_MODES = ['readonly', 'full'] as const
export type McpMode = (typeof MCP_MODES)[number]

export const DEFAULT_MODE: McpMode = 'readonly'

/** Biến môi trường chọn mode; CLI `--mode=` ghi đè. */
export const MODE_ENV_VAR = 'DEVTEAM_MCP_MODE'

export const READ_TOOLS = [
  'list_projects',
  'get_project',
  'get_knowledge_bundle',
  'list_tasks',
  'get_task_state',
  'get_task_context',
  'list_artifacts',
  'read_artifact',
] as const

export const WRITE_TOOLS = ['add_project', 'create_qa', 'remove_project'] as const

export const TOOL_ALLOWLIST: Record<McpMode, readonly string[]> = {
  readonly: READ_TOOLS,
  full: [...READ_TOOLS, ...WRITE_TOOLS],
}

/** Allowlist, không phải denylist: tên lạ luôn `false`. */
export function isToolEnabled(mode: McpMode, tool: string): boolean {
  const allowed = TOOL_ALLOWLIST[mode]
  return allowed ? allowed.includes(tool) : false
}

export function isMcpMode(value: unknown): value is McpMode {
  return typeof value === 'string' && (MCP_MODES as readonly string[]).includes(value)
}

/**
 * Đọc `--mode=<x>` hoặc `--mode <x>` từ argv.
 *
 * Trả `null` khi KHÔNG có flag, và chuỗi rỗng khi có flag mà thiếu giá trị —
 * hai ca khác nhau: "không khai" thì rơi về env, "khai sai" thì cảnh báo và
 * dừng tại mặc định (E7).
 */
export function parseModeArg(argv: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--mode=')) return arg.slice('--mode='.length)
    if (arg === '--mode') return argv[i + 1] ?? ''
  }
  return null
}

/**
 * Thứ tự ưu tiên: CLI `--mode=` → env `DEVTEAM_MCP_MODE` → `DEFAULT_MODE`.
 *
 * Giá trị không nằm trong `MCP_MODES` (kể cả chuỗi rỗng, sai hoa thường, và
 * `project-scoped` khi P3 chưa land) → cảnh báo rồi lùi về `DEFAULT_MODE`. CLI
 * sai KHÔNG rơi ngược về env (E7): một lỗi gõ phím không được lặng lẽ nâng
 * quyền lên `full`.
 *
 * `argv` / `env` / `warn` nhận qua tham số để test không phải mock global.
 */
export function resolveMode(opts: {
  argv?: readonly string[]
  env?: Record<string, string | undefined>
  warn?: (msg: string) => void
} = {}): McpMode {
  const argv = opts.argv ?? process.argv.slice(2)
  const env = opts.env ?? process.env
  // Mặc định ghi `stderr`: `stdout` là kênh JSON-RPC của stdio transport, một
  // dòng log lạc vào đó làm hỏng cả phiên MCP.
  const warn = opts.warn ?? ((msg: string) => void process.stderr.write(`${msg}\n`))

  const raw = parseModeArg(argv) ?? env[MODE_ENV_VAR] ?? null
  if (raw === null) return DEFAULT_MODE
  if (isMcpMode(raw)) return raw

  warn(
    `[dev-team-dashboard mcp] unknown mode ${JSON.stringify(raw)} — expected one of `
      + `${MCP_MODES.join(', ')}; falling back to ${DEFAULT_MODE}`,
  )
  return DEFAULT_MODE
}
