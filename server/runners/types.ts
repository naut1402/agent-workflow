// Shared types for the runner execution plane (U0005).

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
  config?: Record<string, unknown>
}

export interface ProviderCatalogEntry {
  id: string
  kind: ConnectionKind
  label: string
}

export interface ScannedCommand {
  id: string
  command: string
  path: string | null
  available: boolean
  providerId: string
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
}

// `awaiting_approval`: an approval-flow job (see jobQueue.ts) finished
// successfully against a scratch workspace copy — nothing has been written to
// the real files yet. Resolved by approveJob (apply + succeeded),
// discardJob (cancelled), or sendJobFeedback (spawns a new `awaiting_approval`
// job continuing the same CLI session).
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'awaiting_approval'

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
  // Approval flow only (all undefined for a normal job):
  sessionId?: string
  /** Real (non-scratch) directory this job's proposed changes would apply to. */
  applyTarget?: string
  /** Artifact file (relative to `applyTarget`/`workspace`) under review. */
  approvalArtifact?: string
  /** The job this one continued via `--resume` (feedback round chain). */
  parentJobId?: string
  // Selection-splice approval only (see jobQueue.ts runJob): when set, the
  // agent's output (stdout) is spliced back into a copy of the real artifact at
  // this 1-indexed inclusive line range, so every line outside the range stays
  // byte-identical and the review diff is localized to the selection.
  spliceRange?: { start: number; end: number }
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

export const RUNNERS_VERSION = 2
export const CREDENTIALS_VERSION = 1
export const CONNECTIONS_VERSION = 1

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
