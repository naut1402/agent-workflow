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
   * Cách file đến được CLI: `config-file-flag` ⇒ đường dẫn vào argv (`--mcp-config`);
   * `workspace-config-file` ⇒ CLI tự đọc theo cwd, đường dẫn không vào argv.
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

/** Giao MCP bằng một file `mcpServers` CLI đọc — hiện thực chỉ quyết file nằm đâu và dọn ra sao (`write`). */
export abstract class FileMcpDelivery extends McpJobDelivery<McpConfigHandle> {
  abstract override readonly kind: McpConfigHandle['kind']

  /**
   * @param runtimeDir thư mục runtime dưới `registryHome()` — file secret / ledger nằm đây.
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
