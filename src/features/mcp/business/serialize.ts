import { resolveEnvRefs, resolveHeaders } from './resolveRefs.js'
import {
  MCP_MAX_TIMEOUT_MS,
  MCP_MIN_TIMEOUT_MS,
  collectSecretValues,
  isMaskableSecret,
  isStdioServer,
  sanitiseMcpServerId,
  type McpServerConfig,
} from './types.js'

/** Miền của `startupTimeoutSec` (giây) — cùng nguồn với trần/sàn của ô Timeout. */
const STARTUP_TIMEOUT_MIN_SEC = MCP_MIN_TIMEOUT_MS / 1000
const STARTUP_TIMEOUT_MAX_SEC = MCP_MAX_TIMEOUT_MS / 1000

export interface SerialiseContext {
  /** cwd của job — dùng để cảnh báo khi server khai `cwd` khác. */
  workspace: string
  /** Do caller (runner) tiêm — `mcp` không được biết credential store. */
  secretFor?: (credentialId: string) => string | null
}

export interface SerialiseResult {
  json: { mcpServers: Record<string, unknown> }
  /** Giá trị secret đã giải — caller dùng để mask log. */
  secrets: string[]
  warnings: string[]
}

/**
 * Sinh nội dung file `mcpServers` của Claude Code (`--mcp-config`).
 *
 * Shape khoá đã xác minh trên Claude Code 2.1.267 bằng `claude mcp add-json`:
 * `type` nhận `stdio` / `sse` / `http` (`streamable-http` là bí danh, CLI chuẩn
 * hoá về `http`); entry có `url` BẮT BUỘC khai `type`; entry stdio suy được
 * `type` từ `command` nhưng khai tường minh vẫn hợp lệ. Không có khoá `cwd` —
 * CLI bỏ qua, server con kế thừa cwd của tiến trình claude.
 *
 * `startupTimeoutSec` chỉ ghi cho entry stdio: schema của CLI gắn khoá đó sau
 * predicate `transport === 'stdio'`, còn entry remote không spawn tiến trình nào.
 */
export function serialiseMcpServers(
  servers: McpServerConfig[],
  ctx: SerialiseContext,
): SerialiseResult {
  const mcpServers: Record<string, unknown> = {}
  const secrets: string[] = []
  const warnings: string[] = []

  for (const server of servers) {
    const key = sanitiseMcpServerId(server.id)
    if (!key) continue

    // Cả giá trị gõ tay lẫn giá trị đã giải từ `env:NAME` đều có thể là secret và
    // đều đi vào file config, nên cả hai phải nằm trong danh sách mask log.
    secrets.push(...collectSecretValues(server))

    if (isStdioServer(server)) {
      const resolved = resolveEnvRefs(server.env)
      warnings.push(...prefix(server.id, resolved.warnings))
      secrets.push(...Object.values(resolved.env).filter(isMaskableSecret))
      if (server.cwd && server.cwd !== ctx.workspace) {
        warnings.push(
          `${server.id}: cấu hình MCP của CLI không có khoá cwd — server sẽ chạy tại ${ctx.workspace}`,
        )
      }
      const startupTimeoutSec = toStartupTimeoutSec(server.timeoutMs)
      if (startupTimeoutSec !== null) {
        warnings.push(...prefix(server.id, timeoutWarnings(server.timeoutMs!, startupTimeoutSec)))
      }
      mcpServers[key] = {
        type: 'stdio',
        command: server.command,
        args: server.args ?? [],
        env: resolved.env,
        // Khai thiếu khoá ⇒ CLI dùng mặc định 120s của nó; ghi `null` thì entry bị
        // từ chối. Nên server không khai timeout thì entry giữ đúng bốn khoá như cũ.
        ...(startupTimeoutSec === null ? {} : { startupTimeoutSec }),
      }
      continue
    }

    const secret = server.credentialId ? ctx.secretFor?.(server.credentialId) ?? null : null
    if (secret) secrets.push(secret)
    const resolved = resolveHeaders(server, secret)
    warnings.push(...prefix(server.id, resolved.warnings))
    secrets.push(...Object.values(resolved.env).filter(isMaskableSecret))
    mcpServers[key] = {
      type: server.transport,
      url: server.url,
      headers: resolved.env,
    }
  }

  return { json: { mcpServers }, secrets: [...new Set(secrets)], warnings }
}

function prefix(id: string, messages: string[]): string[] {
  return messages.map((m) => `${id}: ${m}`)
}

/**
 * `startupTimeoutSec` của CLI là **số nguyên giây** trong miền [5, 600]; entry mang
 * giá trị ngoài miền bị CLI từ chối, nên kẹp ở đây thay vì đẩy file hỏng xuống.
 *
 * `null` = 🚫 không khai khoá ⇒ CLI dùng mặc định 120s của nó. Đây là thứ giữ cho
 * việc nâng mặc định của dashboard không rò rỉ vào file config.
 *
 * 🚫 Chỉ gọi cho entry stdio: schema CLI chỉ nhận khoá này khi `transport === 'stdio'`
 * (đã đọc lại trên bản 2.1.267), và shape entry remote là contract của bên thứ ba.
 */
function toStartupTimeoutSec(timeoutMs: number | undefined): number | null {
  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return null
  const sec = Math.round(timeoutMs / 1000)
  return Math.min(STARTUP_TIMEOUT_MAX_SEC, Math.max(STARTUP_TIMEOUT_MIN_SEC, sec))
}

/**
 * Hai nguyên nhân khác nhau ⇒ hai thông điệp khác nhau. Nói «ngoài miền [5s, 600s]»
 * cho 7500ms là sai: 7,5s nằm TRONG miền, thứ xảy ra chỉ là làm tròn về giây.
 * Miền được kiểm trên giá trị ms gốc, không trên giá trị đã làm tròn — 4999ms là
 * dưới sàn thật, không phải ca làm tròn.
 */
function timeoutWarnings(timeoutMs: number, startupTimeoutSec: number): string[] {
  if (timeoutMs < MCP_MIN_TIMEOUT_MS || timeoutMs > MCP_MAX_TIMEOUT_MS) {
    return [
      `timeout ${timeoutMs}ms nằm ngoài miền [${STARTUP_TIMEOUT_MIN_SEC}s, ${STARTUP_TIMEOUT_MAX_SEC}s] của CLI — job dùng ${startupTimeoutSec}s`,
    ]
  }
  if (timeoutMs !== startupTimeoutSec * 1000) {
    return [
      `timeout ${timeoutMs}ms được làm tròn thành ${startupTimeoutSec}s — CLI chỉ nhận số nguyên giây`,
    ]
  }
  return []
}
