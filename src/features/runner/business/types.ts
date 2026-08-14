// Shared types for the runner execution plane (U0005).

import type { UsageSnapshot } from '../../../core/log/schema.js'

export interface CredentialProfile {
  id: string
  provider: string
  label: string
  secretRef: string
}

export type ConnectionKind = 'local-console' | 'ai-provider'

/** Provider category — Agent CLI vs console argv vs remote API. */
export type ProviderFamily = 'agent-cli' | 'console-command' | 'ai-api'

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
  config?: Record<string, unknown>
}

export interface ProviderCatalogEntry {
  id: string
  kind: ConnectionKind
  label: string
  /** agent-cli may be set as default AI runner; console-command may not. */
  family: ProviderFamily
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
  // Approval-flow session continuity (see jobQueue.ts submitApprovalJob /
  // sendJobFeedback): exactly one of these is set for an approval job.
  // `sessionId` picks a fresh conversation id for the CLI to persist
  // (`--session-id`); `resumeSessionId` continues that exact conversation on a
  // follow-up feedback round (`--resume`) so the agent remembers what it
  // already proposed instead of starting over.
  sessionId?: string
  resumeSessionId?: string
}

export interface ExecuteResult {
  ok: boolean
  exitCode: number | null
  durationMs: number
  logPath?: string
  artifactsFound?: string[]
  error?: string
  /**
   * The runner's raw stdout. Quick-action approval jobs use this as the
   * proposed content (the agent is told to "respond with the improved text"),
   * so a prompt that prints its result instead of writing a file still produces
   * a reviewable change. See jobQueue.ts runJob.
   */
  stdout?: string
  /** Captured CLI session id (preset-uuid or parse-json providers). */
  sessionId?: string | null
  /** True when runProcess() killed the child after timeoutMs elapsed (SIGTERM).
   * Lets classifyJobFailure() recognize a timeout deterministically instead of
   * matching the CLI's own stdout/stderr text (e.g. Claude Code's interrupt
   * markers "Execution error" / "[Request interrupted by user]"). */
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

export interface CredentialsStore {
  version: number
  profiles: CredentialProfile[]
}

export interface ConnectionsStore {
  version: number
  connections: Connection[]
}

export interface CommandsStore {
  version: number
  commands: CustomCommand[]
}

// A provider plugs a concrete execution backend (e.g. the Claude Code CLI) into
// the runner plane behind a uniform contract.
export interface RunnerProvider {
  providerId: string
  /** Defaults inferred from providerId when omitted (legacy providers). */
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

// Mutation result shape shared by registry/credentials/job CRUD. `ok:false`
// carries an error (and optional HTTP-ish status); `ok:true` carries the payload.
export type MutationOk<T> = { ok: true } & T
export type MutationErr = { ok: false; status?: number; error: string }
export type MutationResult<T = {}> = MutationOk<T> | MutationErr

export const RUNNERS_VERSION = 2
export const CREDENTIALS_VERSION = 1
export const CONNECTIONS_VERSION = 1
export const COMMANDS_VERSION = 1

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
