export type ConnectionKind = 'local-console' | 'ai-provider'

export interface ProviderEntry {
  id: string
  kind: ConnectionKind
  label: string
}

export interface ConnectionOption {
  id: string
  label: string
  kind?: ConnectionKind
  providerId?: string
}

export interface RunnerDraft {
  id: string
  name: string
  connectionId: string
  enabled: boolean
  maxConcurrency: number
  config: {
    timeoutMs: number
    allowedTools: string
  }
}
