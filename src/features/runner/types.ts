export type ConnectionKind = 'local-console' | 'ai-provider'

export type ProviderFamily = 'agent-cli' | 'console-command' | 'ai-api'

export type McpDelivery = 'config-file-flag' | 'workspace-config-file' | 'bridge-tools' | 'unsupported'

export type ModelListing = 'static' | 'api' | 'none'

/**
 * Một dòng catalog provider (`GET /api/runners` · `GET /api/connections`) —
 * bản FE của `ProviderDescriptor` (`business/providers/RunnerProvider.ts`).
 * UI rẽ nhánh theo các trường này, 🚫 so `id` với chuỗi provider cụ thể.
 */
export interface ProviderEntry {
  id: string
  kind: ConnectionKind
  label: string
  family?: ProviderFamily
  /** `unsupported` — the dialog still saves the pick, but warns it has no effect yet. */
  mcpDelivery?: McpDelivery
  /** `false` ⇒ runner không gắn agent (prompt là argv của lệnh). */
  acceptsAgent?: boolean
  /** `static` ⇒ danh sách model cố định, tải không cần credential. */
  modelListing?: ModelListing
  /** Provider hiểu `allowedTools`. */
  supportsAllowedTools?: boolean
  /** Lệnh CLI cục bộ + regex suy provider từ đường dẫn (`match.base` áp tên file, `match.path` áp cả đường dẫn). */
  localCommand?: { id: string; command: string; match: { base: string; path?: string } }
  defaultBaseURL?: string
  modelHint?: string
  secretEnvHint?: string
}

/**
 * Reusable provider template: interface + optional baseURL. Credential
 * selection lives on the Connection itself, not here.
 */
export interface ProviderConfigOption {
  id: string
  label: string
  providerId: string
  baseURL?: string
}

export interface ConnectionOption {
  id: string
  label: string
  /** Như `RunnerDraft.create` — cờ chỉ sống trên payload tạo mới, không persist. */
  create?: true
  kind?: ConnectionKind
  providerId?: string
  cliPath?: string
  flags?: string[]
  credentialId?: string | null
  /**
   * ai-provider: extra settings merged into runnerConfig at execute time.
   * `models` is the user-picked list (nullable — rotation across them is a
   * later feature); `model` mirrors its first entry for the provider
   * wrappers, which only read a single model today. `extraTools` opts this
   * connection into shell/git/search/web tools beyond the base file-ops —
   * absent/empty means unchanged (only the base tools). `mcpServers` lists the
   * MCP server ids this connection opts into — absent/empty means the CLI argv
   * stays exactly as it was.
   */
  config?: Record<string, unknown> & {
    models?: string[]
    model?: string
    baseURL?: string
    extraTools?: string[]
    mcpServers?: string[]
  }
}

export interface RunnerDraft {
  id: string
  name: string
  connectionId: string
  enabled: boolean
  maxConcurrency: number
  /**
   * Chỉ có mặt trên payload gửi đi của dialog tạo mới / copy — BE dùng để chặn
   * ghi đè bản ghi trùng id (409). Không bao giờ được persist vào `runners.json`.
   */
  create?: true
  config: {
    timeoutMs: number
    /** Claude Code CLI only — omitted for console-command / other providers. */
    allowedTools?: string
  }
}
