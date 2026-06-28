// Shared types for the runner execution plane (U0005).

export interface CredentialProfile {
  id: string
  provider: string
  label: string
  secretRef: string
}

export interface RunnerConfig {
  id: string
  name: string
  provider: string
  credentialId: string
  enabled?: boolean
  maxConcurrency?: number
  config: Record<string, unknown>
}

export interface ResolvedAgent {
  ref: string
  name: string
  description: string
  systemPrompt: string
  skills: string[]
  model?: string
  agentFilePath?: string
}

export interface ExecuteRequest {
  jobId: string
  resolvedAgent: ResolvedAgent
  userPrompt: string
  workspace: string
  produces?: string[]
  timeoutMs?: number
  metadata?: Record<string, unknown>
}

export interface ExecuteResult {
  ok: boolean
  exitCode: number | null
  durationMs: number
  logPath?: string
  artifactsFound?: string[]
  error?: string
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface JobRecord {
  id: string
  status: JobStatus
  runnerId: string
  agentRef: string
  workspace: string
  userPrompt?: string
  promptRef?: string
  produces?: string[]
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  exitCode: number | null
  logPath?: string
  error?: string
  artifactsFound?: string[]
  metadata?: Record<string, unknown>
}

export interface RunnersStore {
  version: number
  defaultRunnerId: string | null
  runners: RunnerConfig[]
}

export interface CredentialsStore {
  version: number
  profiles: CredentialProfile[]
}

// A provider plugs a concrete execution backend (e.g. the Claude Code CLI) into
// the runner plane behind a uniform contract.
export interface RunnerProvider {
  providerId: string
  validateRunnerConfig(config: Record<string, unknown> | undefined): { ok: boolean; errors: string[] }
  validateCredential(profile: CredentialProfile | undefined): { ok: boolean; errors: string[] }
  capabilities(): { supportsAgentFile: boolean; supportsStreaming: boolean; maxConcurrency: number }
  execute(
    req: ExecuteRequest,
    runnerConfig: Record<string, any>,
    credential: CredentialProfile,
    onLog?: (chunk: string) => void,
  ): Promise<ExecuteResult>
}

// Mutation result shape shared by registry/credentials/job CRUD. `ok:false`
// carries an error (and optional HTTP-ish status); `ok:true` carries the payload.
export type MutationOk<T> = { ok: true } & T
export type MutationErr = { ok: false; status?: number; error: string }
export type MutationResult<T = {}> = MutationOk<T> | MutationErr

export const RUNNERS_VERSION = 1
export const CREDENTIALS_VERSION = 1

export function sanitiseRunnerId(id: unknown): string | null {
  if (typeof id !== 'string' || !id.trim()) return null
  if (/[\\/\0]/.test(id)) return null
  const clean = id.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
  return clean || null
}

export function sanitiseCredentialId(id: unknown): string | null {
  return sanitiseRunnerId(id)
}
