export type ConnectionKind = 'local-console' | 'ai-provider'

export type ProviderFamily = 'agent-cli' | 'console-command' | 'ai-api'

export interface ProviderEntry {
  id: string
  kind: ConnectionKind
  label: string
  family?: ProviderFamily
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
   * absent/empty means unchanged (only the base tools).
   */
  config?: Record<string, unknown> & { models?: string[]; model?: string; baseURL?: string; extraTools?: string[] }
}

export interface RunnerDraft {
  id: string
  name: string
  connectionId: string
  enabled: boolean
  maxConcurrency: number
  config: {
    timeoutMs: number
    /** Claude Code CLI only — omitted for console-command / other providers. */
    allowedTools?: string
  }
}
