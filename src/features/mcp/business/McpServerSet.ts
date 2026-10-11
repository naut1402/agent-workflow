import type { McpCliContext, McpServer } from './McpServer.js'
import { SecretMasker } from './SecretMasker.js'

/** Nội dung file cấu hình `mcpServers` cho một job, kèm thứ caller cần để log an toàn. */
export interface McpCliConfig {
  json: { mcpServers: Record<string, unknown> }
  /** Id server — an toàn để log; không bao giờ là giá trị env/header. */
  names: string[]
  /** Che giá trị đã giải trước khi ghi stdout/stderr con vào log job. */
  masker: SecretMasker
  /** Cảnh báo lúc chọn server (`McpRegistry.select`) rồi tới cảnh báo lúc sinh entry. */
  warnings: string[]
}

/** Bộ server MCP của một job, chọn qua `McpRegistry.select` — server người dùng trước, entry tự gắn sau. */
export class McpServerSet {
  constructor(
    readonly servers: readonly McpServer[],
    /** Cảnh báo phát sinh lúc chọn — đã đi ra qua `onWarning` của `select`. */
    readonly warnings: readonly string[] = [],
  ) {}

  // xem docs/architecture/code/mcp.md §4
  /** Sinh nội dung file `mcpServers` cho CLI; `onWarning` nhận cảnh báo của bước sinh entry ngay khi phát sinh. */
  toCliConfig(ctx: McpCliContext, onWarning?: (message: string) => void): McpCliConfig {
    const mcpServers: Record<string, unknown> = {}
    const secrets: string[] = []
    const warnings: string[] = [...this.warnings]

    for (const server of this.servers) {
      const key = server.key
      if (!key) continue
      const cli = server.toCliEntry(ctx)
      secrets.push(...cli.secrets)
      for (const message of cli.warnings) {
        warnings.push(message)
        onWarning?.(message)
      }
      mcpServers[key] = cli.entry
    }

    const idByKey = new Map<string, string>()
    for (const server of this.servers) {
      const key = server.key
      if (key) idByKey.set(key, server.id)
    }
    const names = Object.keys(mcpServers).map((key) => idByKey.get(key) ?? key)

    return { json: { mcpServers }, names, masker: new SecretMasker(secrets), warnings }
  }
}
