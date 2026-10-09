export type ConnectionKind = 'local-console' | 'ai-provider'

export type ProviderFamily = 'agent-cli' | 'console-command' | 'ai-api'

export type McpDelivery = 'config-file-flag' | 'workspace-config-file' | 'bridge-tools' | 'unsupported'

export interface ProviderEntry {
  id: string
  kind: ConnectionKind
  label: string
  family?: ProviderFamily
  /** `unsupported` — the dialog still saves the pick, but warns it has no effect yet. */
  mcpDelivery?: McpDelivery
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
   * `models` is the user-picked list; `model` mirrors its first entry for the
   * provider wrappers. `extraTools` opts into shell/git/search/web tools and
   * `mcpServers` into MCP servers (absent/empty ⇒ none).
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
