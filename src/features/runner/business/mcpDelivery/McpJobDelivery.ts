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
  /**
   * Nhận cảnh báo ngay khi phát sinh, kể cả khi `prepare` trả `null`. Id bị
   * tắt/xoá sau khi Connection đã chọn thì không còn handle nào để mang
   * `warnings` ra, mà job chạy thiếu tool trong im lặng là thứ không ai truy
   * ngược được.
   */
  onWarning?(message: string): void
  /** Dòng log nguyên văn (đã có `\n`) ghi vào log job — không phải cảnh báo. */
  onLog?(line: string): void
}

/**
 * Cách một provider nhận cấu hình MCP cho job (Template Method).
 *
 * `prepare` giữ trình tự cố định: entry tự gắn → chọn server → giao. Hiện thực
 * chỉ quyết phần "giao" (`attach`) và, nếu cần, entry tự gắn (`extraServers`).
 *
 * 📌 Bất biến `null`: không `ids` VÀ không entry tự gắn — hoặc mọi id đều rụng —
 * thì `prepare` trả `null` TRƯỚC `attach`. Đó là đường mặc định của mọi job
 * thường: không file nào chạm đĩa, argv CLI không đổi, không phiên MCP nào mở.
 */
export abstract class McpJobDelivery<THandle> {
  /** Giá trị catalog trả cho FE (`ProviderCatalogEntry.mcpDelivery`). */
  abstract readonly kind: McpDelivery

  /**
   * Cách giao này có mang được entry MCP trỏ vào chính dashboard không — tuyến
   * `mcp` của node điều phối (`resolveDecisionRoute`) đọc cờ này.
   */
  // fallow-ignore-next-line unused-class-member -- gọi đa hình qua `RunnerProvider.mcpDelivery?.acceptsSelfServer` (`orchestrator/business/mcpRoute.ts`)
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

  /** Server do dashboard TỰ gắn, ghi SAU server của người dùng nên trùng khoá thì thắng. */
  protected extraServers(_input: McpJobInput): McpServer[] {
    return []
  }

  protected abstract attach(set: McpServerSet, input: McpJobInput): Promise<THandle | null> | THandle | null

  /**
   * Dọn dấu vết của lượt giao mồ côi (tiến trình bị kill giữa job) lúc bootstrap.
   * Mặc định không có gì để dọn. 🚫 Không được ném — chạy lúc nạp module.
   */
  // fallow-ignore-next-line unused-class-member -- gọi đa hình qua `provider.mcpDelivery.cleanupOrphans()` (`cleanupOrphanedMcpDeliveries`, `registry.ts`)
  cleanupOrphans(): void {}
}
