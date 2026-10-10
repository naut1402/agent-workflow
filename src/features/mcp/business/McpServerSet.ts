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

/**
 * Bộ server MCP của MỘT job — đã chọn, đã lọc server tắt/rụng. Dựng qua
 * `McpRegistry.select`; `servers` theo thứ tự ghi: server người dùng trước, entry
 * dashboard tự gắn sau.
 */
export class McpServerSet {
  constructor(
    readonly servers: readonly McpServer[],
    /** Cảnh báo phát sinh lúc chọn — đã đi ra qua `onWarning` của `select`. */
    readonly warnings: readonly string[] = [],
  ) {}

  /**
   * Sinh nội dung file `mcpServers` của Claude Code (`--mcp-config`).
   *
   * Shape khoá đã xác minh trên Claude Code 2.1.267 bằng `claude mcp add-json`:
   * `type` nhận `stdio` / `sse` / `http` (`streamable-http` là bí danh, CLI chuẩn
   * hoá về `http`); entry có `url` BẮT BUỘC khai `type`; entry stdio suy được
   * `type` từ `command` nhưng khai tường minh vẫn hợp lệ. Không có khoá `cwd` —
   * CLI bỏ qua, server con kế thừa cwd của tiến trình claude.
   *
   * Ghi theo thứ tự `servers` nên trùng khoá thì bản ghi SAU thắng — entry tự gắn
   * đứng cuối nên thắng entry người dùng trùng tên.
   *
   * `onWarning` nhận cảnh báo của bước sinh entry ngay khi phát sinh (cảnh báo
   * của bước chọn đã đi ra ở `select`).
   */
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

    // Một tên cho mỗi entry THẬT trong file: id trùng nhau chỉ sinh một entry
    // (báo 2 là báo sai thứ job nhận được), và server có id sanitise ra `null`
    // không vào file nên không được đếm. Nhưng tên hiển thị vẫn là id NGƯỜI DÙNG
    // gõ, 🚫 không phải khoá đã sanitise — giữ nguyên hợp đồng dòng log cũ để
    // tên khớp với tab MCP. Khoá trùng ⇒ lấy id của server thắng (ghi sau).
    const idByKey = new Map<string, string>()
    for (const server of this.servers) {
      const key = server.key
      if (key) idByKey.set(key, server.id)
    }
    const names = Object.keys(mcpServers).map((key) => idByKey.get(key) ?? key)

    return { json: { mcpServers }, names, masker: new SecretMasker(secrets), warnings }
  }
}
