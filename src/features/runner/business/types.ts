import type { UsageSnapshot } from '../../../shared/log/schema.js'

export interface CredentialProfile {
  id: string
  provider: string
  label: string
  secretRef: string
}

export type ConnectionKind = 'local-console' | 'ai-provider'

/** Provider category — Agent CLI vs console argv vs remote API. */
export type ProviderFamily = 'agent-cli' | 'console-command' | 'ai-api'

/** How a provider receives the `mcpServers` config the dashboard declares. */
export type McpDelivery =
  /** Per-invocation flag: `--mcp-config <file> --strict-mcp-config` (claude). */
  | 'config-file-flag'
  /** File read from the workspace, with no flag pointing at it (cursor). */
  | 'workspace-config-file'
  /** Tools injected into the provider's own tool-use loop (ai-api). */
  | 'bridge-tools'
  | 'unsupported'

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
   * (`models`/`model`/`baseURL`, …). `extraTools?: string[]` opts an
   * `ai-provider` Connection into shell/git/search/web tools; `mcpServers?:
   * string[]` lists the MCP server ids it opts into (absent/empty ⇒ no MCP).
   * For `claude-code-cli`, `model` becomes the `--model` argv value.
   */
  config?: Record<string, unknown>
}

export interface ProviderCatalogEntry {
  id: string
  kind: ConnectionKind
  label: string
  /** agent-cli may be set as default AI runner; console-command may not. */
  family: ProviderFamily
  /** How this provider receives MCP config — `listProviderCatalog` fills it in. */
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

export interface ExecuteRequest {
  jobId: string
  resolvedAgent: ResolvedAgent
  userPrompt: string
  workspace: string
  produces?: string[]
  timeoutMs?: number
  metadata?: Record<string, unknown>
  /** Fresh session id for the CLI to persist (`--session-id`); exclusive with `resumeSessionId`. */
  sessionId?: string
  /** Existing session to continue (`--resume`). */
  resumeSessionId?: string
  /**
   * Aborted when `cancelJob` is called for this job. Providers with no OS
   * subprocess to SIGTERM (AgenticApiProvider subclasses) should thread this
   * into their fetch/SDK calls; subprocess-spawning providers can ignore it
   * (they are killed via `job.pid` instead).
   */
  signal?: AbortSignal
}

export interface ExecuteResult {
  ok: boolean
  exitCode: number | null
  durationMs: number
  logPath?: string
  artifactsFound?: string[]
  error?: string
  /**
   * The runner's raw stdout. Quick-action approval jobs use it as the proposed
   * content.
   */
  stdout?: string
  /**
   * `stdout` with MCP secrets masked, for the persist/API boundary only
   * (`JobRecord.stdout`, `GET /api/jobs`); unset when the job has no MCP secret.
   * xem docs/architecture/code/runner.md §4
   */
  maskedStdout?: string
  /** Captured CLI session id (preset-uuid or parse-json providers). */
  sessionId?: string | null
  /** True when runProcess() killed the child after timeoutMs elapsed (SIGTERM). */
  timedOut?: boolean
  /** Optional token usage (Agent CLI); see providers/agentCli.ts. */
  tokenUsage?: {
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    totalTokens?: number
    model?: string
    estimated?: boolean
  }
}

/** `awaiting_approval`: an approval job finished against a scratch copy; resolved by `approveJob`, `discardJob` or `sendJobFeedback`. */
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
   * Agent reply (stdout, MCP secrets masked), persisted for chat surfaces.
   * Capped; never the full job log.
   */
  stdout?: string
  metadata?: Record<string, unknown>
  /** CLI session id, shared by approval feedback (`sendJobFeedback`) and task chat resume (`sendTaskFeedback`). */
  sessionId?: string
  /** Real (non-scratch) directory this job's proposed changes would apply to (approval flow only). */
  applyTarget?: string
  /** Artifact file (relative to `applyTarget`/`workspace`) under review (approval flow only). */
  approvalArtifact?: string
  /** The job this one continued via `--resume` (approval feedback round, or a task-chat-feedback round). */
  parentJobId?: string
  /** Selection-splice approval only: 1-indexed inclusive line range the agent's output is spliced into. */
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

/** Reusable provider template: interface + optional baseURL; credentials live on the Connection. */
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

/** Uniform contract that plugs an execution backend into the runner plane. */
export interface RunnerProvider {
  providerId: string
  /** Inferred from providerId when omitted. */
  family?: ProviderFamily
  validateRunnerConfig(config: Record<string, unknown> | undefined): { ok: boolean; errors: string[] }
  validateCredential(profile: CredentialProfile | undefined): { ok: boolean; errors: string[] }
  capabilities(): { supportsAgentFile: boolean; supportsStreaming: boolean; maxConcurrency: number }
  execute(
    req: ExecuteRequest,
    runnerConfig: Record<string, any>,
    credential: CredentialProfile,
    onLog?: (chunk: string) => void,
    onStart?: (info: { pid: number | null }) => void,
  ): Promise<ExecuteResult>
}

/** Result of registry/credentials/job CRUD; `ok: false` carries an error and optional HTTP status. */
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
