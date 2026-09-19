import { resolveEnvRefs, resolveHeaders } from './resolveRefs.js'
import {
  collectSecretValues,
  isMaskableSecret,
  isStdioServer,
  sanitiseMcpServerId,
  type McpServerConfig,
} from './types.js'

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
      mcpServers[key] = {
        type: 'stdio',
        command: server.command,
        args: server.args ?? [],
        env: resolved.env,
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
