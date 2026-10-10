import { McpJobDelivery } from './McpJobDelivery.js'

/**
 * Provider không nhận MCP (codex, console) — Null Object.
 *
 * `prepare` trả `null` NGAY, không chọn server nào và 🚫 không cảnh báo gì: đúng
 * hành vi trước khi có delivery, khi provider này không bao giờ đọc
 * `Connection.config.mcpServers`.
 */
export class NoMcpDelivery extends McpJobDelivery<null> {
  readonly kind = 'unsupported' as const

  override async prepare(): Promise<null> {
    return null
  }

  protected attach(): null {
    return null
  }
}
