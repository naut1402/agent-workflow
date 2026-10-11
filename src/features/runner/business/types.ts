import type { UsageSnapshot } from '../../../shared/log/schema.js'
import type { McpDelivery, ProviderDescriptor } from './providers/RunnerProvider.js'

export type {
  ExecuteRequest,
  ExecuteResult,
  McpDelivery,
  ProviderDescriptor,
  ProviderFamily,
  RunnerProvider,
  UsageCaptureInput,
} from './providers/RunnerProvider.js'

export interface CredentialProfile {
  id: string
  provider: string
  label: string
  secretRef: string
}

export type ConnectionKind = 'local-console' | 'ai-provider'

export interface Connection {
  id: string
  label: string
  kind: ConnectionKind
  /** Backend provider id: claude-code-cli | cursor-cli | codex-cli | console-command | … */
  providerId: string
  /** local-console: path CLI đã scan/chọn */
  cliPath?: string
  /** local-console: argv tuỳ chọn khi spawn */
  flags?: string[]
  /** ai-provider: trỏ credential profile */
  credentialId?: string | null
  /**
   * Free-form settings merged into `runnerConfig` at execute time
   * (`models`/`model`/`baseURL`, `extraTools`, `mcpServers`, …).
   */
  config?: Record<string, unknown>
}

/** Dòng catalog provider trả cho UI: `ProviderDescriptor` + cách giao MCP của delivery đã lắp ráp. */
export type ProviderCatalogEntry = ProviderDescriptor & {
  mcpDelivery?: McpDelivery
}

export interface ScannedCommand {
  id: string
  command: string
  path: string | null
  available: boolean
  providerId: string
  /** Custom commands persisted in commands.json (editable / deletable). */
  custom?: boolean
  flags?: string[]
}

/** User-registered local console command (registryHome/commands.json). */
export interface CustomCommand {
  id: string
  command: string
  path: string
  providerId: string
  flags: string[]
}

export interface RunnerConfig {
  id: string
  name: string
  connectionId: string
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

export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'awaiting_approval'
  | 'awaiting_recovery'

export type JobFailureKind = 'usage_limit' | 'network' | 'process_crash'

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
  /** OS pid of the spawned process tree root (cmd.exe on win32 shell spawn). */
  pid?: number | null
  logPath?: string
  error?: string
  artifactsFound?: string[]
  /** Agent reply persisted for chat surfaces (capped) — never the full job log. */
  stdout?: string
  metadata?: Record<string, unknown>
  sessionId?: string
  /** Real (non-scratch) directory this job's proposed changes would apply to (approval flow only). */
  applyTarget?: string
  /** Artifact file (relative to `applyTarget`/`workspace`) under review (approval flow only). */
  approvalArtifact?: string
  /** The job this one continued via `--resume` (approval feedback round, or a task-chat-feedback round). */
  parentJobId?: string
  /** Selection-splice approval only: 1-indexed inclusive line range the proposal is spliced into. */
  spliceRange?: { start: number; end: number }
  /** Aggregated LLM token usage for this job. */
  usage?: UsageSnapshot
  /** Retry counter for process_crash recovery (defaults to 0 when absent). */
  attemptCount?: number
  /** Last classified failure kind — debug/UI only. */
  failureKind?: JobFailureKind
}

export interface RunnersStore {
  version: number
  defaultRunnerId: string | null
  runners: RunnerConfig[]
}

/** Vì sao runner mặc định đã ghi nhận không dùng được; `ok` = dùng được. */
export type DefaultRunnerReason =
  | 'ok'
  | 'no-runners'
  | 'unset'
  | 'missing'
  | 'disabled'
  | 'no-connection'
  | 'not-ai'

/**
 * Kết quả giải runner mặc định. `runnerId` giữ id đã ghi nhận kể cả khi runner
 * đó không dùng được, để log và UI nêu đúng runner nào đang hỏng.
 */
export interface DefaultRunnerResolution {
  runner: RunnerConfig | null
  runnerId: string | null
  reason: DefaultRunnerReason
}

export interface CredentialsStore {
  version: number
  profiles: CredentialProfile[]
}

export interface ConnectionsStore {
  version: number
  connections: Connection[]
}

export interface ProviderConfig {
  id: string
  label: string
  providerId: string
  baseURL?: string
}

export interface ProviderConfigsStore {
  version: number
  providerConfigs: ProviderConfig[]
}

export interface CommandsStore {
  version: number
  commands: CustomCommand[]
}

export type MutationOk<T> = { ok: true } & T
export type MutationErr = { ok: false; status?: number; error: string }
export type MutationResult<T = {}> = MutationOk<T> | MutationErr

export const RUNNERS_VERSION = 2
export const CREDENTIALS_VERSION = 1
export const CONNECTIONS_VERSION = 1
export const COMMANDS_VERSION = 1
export const PROVIDER_CONFIGS_VERSION = 1

export const DEFAULT_CONNECTION_ID = 'claude-code-cli-local'

export function sanitiseRunnerId(id: unknown): string | null {
  if (typeof id !== 'string' || !id.trim()) return null
  if (/[\\/\0]/.test(id)) return null
  const clean = id.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
  return clean || null
}

export function sanitiseCredentialId(id: unknown): string | null {
  return sanitiseRunnerId(id)
}

export function sanitiseConnectionId(id: unknown): string | null {
  return sanitiseRunnerId(id)
}

export function sanitiseCommandId(id: unknown): string | null {
  return sanitiseRunnerId(id)
}

export function sanitiseProviderConfigId(id: unknown): string | null {
  return sanitiseRunnerId(id)
}
