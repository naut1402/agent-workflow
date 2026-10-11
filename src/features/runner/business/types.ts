// Dữ liệu / store của runner (U0005). Hợp đồng provider (`RunnerProvider`,
// `ExecuteRequest/Result`, `TokenUsage`, `ProviderFamily`, `McpDelivery`) nằm ở
// `providers/RunnerProvider.ts`; re-export dưới đây giữ cho nơi import cũ trong
// giai đoạn chuyển.

import type { UsageSnapshot } from '../../../shared/log/schema.js'
import type { McpDelivery, ProviderDescriptor } from './providers/RunnerProvider.js'

export type {
  CompletionRequest,
  CompletionResult,
  ExecuteRequest,
  ExecuteResult,
  McpDelivery,
  ModelListing,
  ProviderCatalogInfo,
  ProviderDescriptor,
  ProviderFamily,
  RunnerProvider,
  RegisteredProvider,
  TokenUsage,
  TranscriptFormat,
  UsageCaptureInput,
  UsageSource,
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
   * (`models`/`model`/`baseURL`, …). For `ai-provider` (`ai-api`),
   * `extraTools?: string[]` opts this Connection into shell/git/search/web
   * tools beyond the base 4 file-ops (see `AgenticApiProvider.resolveExtraTools`)
   * — optional and absent on connections created before this key existed,
   * which then get only the base tools (unchanged behavior). For
   * `local-console` with `providerId: 'claude-code-cli'`, `model` is read
   * as the `--model` argv value (see `ClaudeCliProvider.ts`).
   *
   * `mcpServers?: string[]` lists the MCP server ids this Connection opts into
   * (`features/mcp` store). Absent/empty — the default for every connection
   * created before the key existed — means no MCP config file is written and
   * the CLI argv is unchanged.
   */
  config?: Record<string, unknown>
}

/**
 * Một dòng catalog provider trả cho UI — `ProviderDescriptor` + cách giao MCP
 * lấy từ delivery đã lắp ráp (`listProviderCatalog`, providerRegistry.ts).
 */
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

// `awaiting_approval`: an approval-flow job (see jobQueue.ts) finished
// successfully against a scratch workspace copy — nothing has been written to
// the real files yet. Resolved by approveJob (apply + succeeded),
// discardJob (cancelled), or sendJobFeedback (spawns a new `awaiting_approval`
// job continuing the same CLI session).
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
  /**
   * The CLI's raw stdout (or parsed agent `result`), persisted for NL chat and
   * Agent CLI pipeline jobs so task chat can show the reply when the on-disk
   * session transcript is missing. Capped; never treat the full job log as this.
   */
  stdout?: string
  metadata?: Record<string, unknown>
  // `sessionId`/`parentJobId` are shared by two independent feedback flows:
  // approval (`sendJobFeedback`, keyed by `jobId`) and task-chat-resume
  // (`sendTaskFeedback`, keyed by `taskId`, see jobQueue.ts). Only
  // `applyTarget`/`approvalArtifact` below are approval-flow only.
  sessionId?: string
  /** Real (non-scratch) directory this job's proposed changes would apply to (approval flow only). */
  applyTarget?: string
  /** Artifact file (relative to `applyTarget`/`workspace`) under review (approval flow only). */
  approvalArtifact?: string
  /** The job this one continued via `--resume` (approval feedback round, or a task-chat-feedback round). */
  parentJobId?: string
  // Selection-splice approval only (see jobQueue.ts runJob): when set, the
  // agent's output (stdout) is spliced back into a copy of the real artifact at
  // this 1-indexed inclusive line range, so every line outside the range stays
  // byte-identical and the review diff is localized to the selection.
  spliceRange?: { start: number; end: number }
  /** Aggregated LLM token usage for this job (Claude transcript capture, P0). */
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
 * Kết quả giải runner mặc định. `runnerId` giữ id **đã ghi nhận** kể cả khi runner
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

// A reusable provider "template": interface + optional baseURL. Credential
// selection lives on the Connection itself, not here.
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

// Mutation result shape shared by registry/credentials/job CRUD. `ok:false`
// carries an error (and optional HTTP-ish status); `ok:true` carries the payload.
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
