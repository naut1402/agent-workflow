import type { UsageSnapshot } from '../../../../shared/log/schema.js'
import type { McpJobDelivery } from '../mcpDelivery/McpJobDelivery.js'
import type { ConnectionKind, CredentialProfile, JobRecord, ResolvedAgent } from '../types.js'

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

/**
 * Định dạng transcript provider để lại trên đĩa; monitor chọn reader theo giá trị này.
 * `agent-sdk` là transcript runner tự ghi (`agentTranscriptFile()`).
 */
export type TranscriptFormat = 'claude-projects' | 'cursor-projects' | 'agent-sdk' | 'none'

/** Cách UI lấy danh sách model: `static` cố định, `api` gọi endpoint (cần API key), `none` không liệt kê được. */
export type ModelListing = 'static' | 'api' | 'none'

/** Token usage optionally returned by `execute()`. */
export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  totalTokens?: number
  model?: string
  /** Heuristic estimate when CLI does not report usage. */
  estimated?: boolean
}

/** Mô tả provider cho UI và caller — catalog `GET /api/runners` · `GET /api/connections` trả nguyên các trường này. */
export interface ProviderDescriptor {
  id: string
  kind: ConnectionKind
  label: string
  family: ProviderFamily
  /** `false` ⇒ job chạy không gắn agent (system prompt bỏ qua, agentRef bị lờ). */
  acceptsAgent: boolean
  modelListing: ModelListing
  /** Provider hiểu `runnerConfig.allowedTools` (UI hiện ô nhập). */
  supportsAllowedTools?: boolean
  transcriptFormat?: TranscriptFormat
  /**
   * Lệnh CLI cục bộ để scan PATH. `match.base`: regex (không phân biệt hoa thường) trên tên file
   * đã bỏ đuôi `.exe/.cmd/.bat/.ps1`; `match.path`: regex trên cả đường dẫn.
   */
  localCommand?: { id: string; command: string; match: { base: string; path?: string } }
  /** Base URL mặc định của endpoint API (UI dùng làm placeholder). */
  defaultBaseURL?: string
  /** Ví dụ model id (placeholder UI). */
  modelHint?: string
  /** Ví dụ `secretRef` (placeholder UI). */
  secretEnvHint?: string
}

/** Phần mô tả UI provider tự khai — `id`/`family`/`acceptsAgent` lấy từ chính provider. */
export type ProviderCatalogInfo = Omit<ProviderDescriptor, 'id' | 'family' | 'acceptsAgent' | 'transcriptFormat'>

export interface ExecuteRequest {
  jobId: string
  resolvedAgent: ResolvedAgent
  userPrompt: string
  workspace: string
  produces?: string[]
  timeoutMs?: number
  metadata?: Record<string, unknown>
  /** Fresh conversation id the CLI persists (`--session-id`). */
  sessionId?: string
  /** Conversation to continue (`--resume`). */
  resumeSessionId?: string
  /** Aborted by `cancelJob` — in-process providers (no subprocess to kill) pass it to their fetch/SDK calls. */
  signal?: AbortSignal
}

export interface ExecuteResult {
  ok: boolean
  exitCode: number | null
  durationMs: number
  logPath?: string
  artifactsFound?: string[]
  error?: string
  /** The runner's raw stdout — functional paths (approval proposal, orchestrator decision) read this. */
  stdout?: string
  // xem docs/architecture/code/runner.md §5
  /** Bản `stdout` đã mask secret MCP, chỉ dùng ở biên persist/API; không set khi job không bật MCP. */
  maskedStdout?: string
  /** Captured CLI session id (preset-uuid or parse-json providers). */
  sessionId?: string | null
  /** True when `runCliProcess()` killed the child after `timeoutMs` — `classifyJobFailure()` reads this instead of CLI output. */
  timedOut?: boolean
  /** Optional token usage — persisted with `source: 'stdout'` (usageCapture.ts). */
  tokenUsage?: TokenUsage
}

/** Nguồn bản ghi usage — hợp đồng dữ liệu với statistics. */
export type UsageSource = 'aggregate' | 'stdout'

/** Đầu vào hook `captureUsage`: provider đọc usage từ nguồn riêng rồi ghi với `source = 'aggregate'`. */
export interface UsageCaptureInput {
  job: JobRecord
  sessionId: string
}

/** Một lượt hỏi-đáp không tool, không workspace, không session (hook `complete`). */
export interface CompletionRequest {
  prompt: string
  system?: string
  maxTokens?: number
  timeoutMs?: number
  signal?: AbortSignal
}

export type CompletionResult =
  | { ok: true; text: string; usage?: TokenUsage }
  | { ok: false; error: string }

// xem docs/architecture/code/runner.md §4
/** Hợp đồng một provider cắm backend thực thi (Agent CLI, lệnh console, API AI) vào runner. */
export interface RunnerProvider {
  providerId: string
  family?: ProviderFamily
  /** `false` ⇒ jobQueue chạy job không gắn agent (console-command). */
  acceptsAgent?: boolean
  /** How this provider receives the job's MCP servers — `NoMcpDelivery` when it takes none. */
  mcpDelivery?: McpJobDelivery<unknown>
  /** Transcript provider để lại trên đĩa — đọc qua `transcriptFormatOf()`. */
  transcriptFormat?: TranscriptFormat
  /** Mô tả UI — có thì provider xuất hiện trong catalog. */
  catalog?: ProviderCatalogInfo
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
  /**
   * Danh sách model provider đang phục vụ. `catalog.modelListing === 'api'` thì
   * caller giải API key trước; `'static'` thì gọi với `apiKey` rỗng.
   */
  listModels?(apiKey: string, baseURL: string): Promise<string[]>
  /**
   * Ghi usage của job từ nguồn riêng của provider (vd transcript CLI). Usage có
   * sẵn trên `ExecuteResult.tokenUsage` thì jobQueue tự ghi — không cần hook.
   */
  captureUsage?(input: UsageCaptureInput): Promise<void>
  /** Một lượt hỏi-đáp ngoài job (vd sinh bản nháp) — chỉ provider API hiện thực. */
  complete?(
    input: CompletionRequest,
    runnerConfig: Record<string, any>,
    credential: CredentialProfile,
  ): Promise<CompletionResult>
}

/** Provider đã qua `registerProvider` / lắp ráp — đủ các trường caller dựa vào. */
export type RegisteredProvider = RunnerProvider &
  Required<Pick<RunnerProvider, 'family' | 'acceptsAgent' | 'mcpDelivery'>>

// xem docs/architecture/code/runner.md §14
/** Gửi system prompt của agent, trừ lượt chat resume cùng agent (`isChatFeedback`). */
export function shouldSendAgentInstructions(req: ExecuteRequest): boolean {
  return !(req.resumeSessionId && req.metadata?.isChatFeedback === true)
}
