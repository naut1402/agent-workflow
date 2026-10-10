import type {
  CredentialResolver,
  McpCliConfig,
  McpServerSet,
  SecretMasker,
} from '../../../mcp/business/index.js'
import type { McpDelivery } from '../types.js'
import { McpJobDelivery, type McpJobInput } from './McpJobDelivery.js'

/** Kết quả giao MCP bằng file cấu hình — sống đúng một job, `dispose()` trong `finally`. */
export interface McpConfigHandle {
  /**
   * Cách file đến được CLI. `config-file-flag` ⇒ đường dẫn đi vào argv
   * (`--mcp-config`); `workspace-config-file` ⇒ CLI tự đọc theo cwd và đường dẫn
   * 🚫 KHÔNG được lọt vào argv. Caller phân biệt bằng field này, không đoán theo
   * hình dạng `path`.
   */
  kind: Extract<McpDelivery, 'config-file-flag' | 'workspace-config-file'>
  path: string
  count: number
  /** Id server — an toàn để log; không bao giờ là giá trị env/header. */
  names: string[]
  /** Giá trị đã giải, để caller mask trước khi ghi stdout/stderr con vào log job. */
  masker: SecretMasker
  warnings: string[]
  dispose(): void
}

/**
 * Giao MCP bằng một file `mcpServers` mà CLI đọc. Phần chung — dựng nội dung
 * file từ bộ server đã chọn, kể cả giải credential — nằm ở đây; hiện thực chỉ
 * quyết file nằm đâu, đến CLI bằng cách nào và dọn ra sao (`write`).
 */
export abstract class FileMcpDelivery extends McpJobDelivery<McpConfigHandle> {
  abstract override readonly kind: McpConfigHandle['kind']

  /**
   * @param runtimeDir thư mục runtime dưới `registryHome()` — file secret / ledger
   *   nằm đây, 🚫 không trong workspace người dùng (trừ chỗ CLI bắt buộc).
   * @param credentials giải `credentialId` của server từ xa thành secret.
   */
  constructor(
    protected readonly runtimeDir: () => string,
    protected readonly credentials: CredentialResolver,
  ) {
    super()
  }

  protected attach(set: McpServerSet, input: McpJobInput): McpConfigHandle | null {
    const config = set.toCliConfig(
      { workspace: input.workspace, credentials: this.credentials },
      input.onWarning,
    )
    return this.write(config, input)
  }

  /** Ghi `config.json` tới chỗ CLI đọc được. `null` ⇒ job chạy không có MCP. */
  protected abstract write(config: McpCliConfig, input: McpJobInput): McpConfigHandle | null
}
