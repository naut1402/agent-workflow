import { mcpRegistry, type McpServer, type McpServerSet } from '../../../mcp/business/index.js'
import type { McpDelivery } from '../types.js'

/** Đầu vào của một lượt giao MCP cho job — chung cho mọi cách giao. */
export interface McpJobInput {
  /** `Connection.config.mcpServers` — id server người dùng đã bật. */
  ids: unknown
  workspace: string
  jobId: string
  /** `ExecuteRequest.metadata` — cách giao nào cần (entry tự gắn) thì đọc. */
  metadata?: Record<string, unknown>
  /** Nhận cảnh báo ngay khi phát sinh, kể cả khi `prepare` trả `null`. */
  onWarning?(message: string): void
  /** Dòng log nguyên văn (đã có `\n`) ghi vào log job — không phải cảnh báo. */
  onLog?(line: string): void
}

// xem docs/mcp/client.md §7
/**
 * Cách một provider nhận cấu hình MCP cho job (Template Method): entry tự gắn → chọn server
 * → `attach`. Không còn server nào thì `prepare` trả `null` trước `attach`.
 */
export abstract class McpJobDelivery<THandle> {
  /** Giá trị catalog trả cho FE (`ProviderCatalogEntry.mcpDelivery`). */
  abstract readonly kind: McpDelivery

  /**
   * Cách giao này có mang được entry MCP trỏ vào chính dashboard không — tuyến
   * `mcp` của node điều phối (`resolveDecisionRoute`) đọc cờ này.
   */
  get acceptsSelfServer(): boolean {
    return false
  }

  async prepare(input: McpJobInput): Promise<THandle | null> {
    const set = mcpRegistry.select({
      ids: input.ids,
      extras: this.extraServers(input),
      onWarning: input.onWarning,
    })
    if (!set) return null
    return this.attach(set, input)
  }

  /** Server do dashboard tự gắn, ghi sau server của người dùng nên trùng khoá thì thắng. */
  protected extraServers(_input: McpJobInput): McpServer[] {
    return []
  }

  protected abstract attach(set: McpServerSet, input: McpJobInput): Promise<THandle | null> | THandle | null

  /** Dọn dấu vết của lượt giao mồ côi lúc bootstrap — không được ném. */
  cleanupOrphans(): void {}
}
