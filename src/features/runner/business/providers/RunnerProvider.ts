// Hợp đồng một provider cắm backend thực thi (Agent CLI, lệnh console, API AI)
// vào runner. Caller (jobQueue, modelCatalog, controller, feature khác) chỉ biết
// file này; hiện thực cụ thể chỉ `providerRegistry.ts` biết.
//
// 🚫 Không đặt tên binary, env var, path hay tên nhà cung cấp ở đây — mỗi hiện
// thực tự khai báo qua các trường / hook bên dưới.

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
 * Định dạng transcript provider để lại trên đĩa — bộ đọc chat (monitor) chọn
 * reader theo giá trị này thay vì so `providerId`.
 * - `claude-projects` — JSONL do CLI tự ghi dưới thư mục projects của nó.
 * - `cursor-projects` — transcript do CLI Cursor tự ghi.
 * - `agent-sdk` — runner tự ghi (`agentTranscriptFile()`).
 * - `none` — provider không để lại transcript đọc được.
 */
export type TranscriptFormat = 'claude-projects' | 'cursor-projects' | 'agent-sdk' | 'none'

/**
 * Cách UI lấy danh sách model cho provider.
 * - `static` — danh sách cố định, không cần credential.
 * - `api` — gọi endpoint của provider, cần API key.
 * - `none` — không liệt kê được (người dùng gõ tay hoặc không có model).
 */
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

/**
 * Value object mô tả provider cho UI và cho caller — thứ trước đây FE và
 * `connections.ts` giữ bản sao theo `providerId`. Catalog (`GET /api/runners`,
 * `GET /api/connections`) trả nguyên các trường này.
 */
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
   * Lệnh CLI cục bộ — scan PATH và suy provider từ đường dẫn người dùng chọn.
   * `match.base` là regex (không phân biệt hoa thường) áp lên tên file đã bỏ
   * đuôi `.exe/.cmd/.bat/.ps1`; `match.path` áp lên cả đường dẫn.
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
  // Approval-flow session continuity (see jobQueue.ts submitApprovalJob /
  // sendJobFeedback): exactly one of these is set for an approval job.
  // `sessionId` picks a fresh conversation id for the CLI to persist
  // (`--session-id`); `resumeSessionId` continues that exact conversation on a
  // follow-up feedback round (`--resume`) so the agent remembers what it
  // already proposed instead of starting over.
  sessionId?: string
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
   * The runner's raw stdout. Quick-action approval jobs use this as the
   * proposed content (the agent is told to "respond with the improved text"),
   * so a prompt that prints its result instead of writing a file still produces
   * a reviewable change. See jobQueue.ts runJob.
   */
  stdout?: string
  /**
   * Bản `stdout` đã mask secret MCP — DÀNH RIÊNG cho biên persist/API
   * (`JobRecord.stdout`, `metadata.stepSummary`, `GET /api/jobs`).
   *
   * 🚫 Không dùng cho đường chức năng: `foldProposalIntoScratch` và
   * `parseOrchestratorDecision` đọc `stdout` THÔ — mask là split/join mù, nó cắt
   * giữa artifact và giữa dòng `ORCHESTRATOR_DECISION`.
   *
   * Không set khi job không bật MCP server nào ⇒ caller rơi về `stdout`, hành vi
   * cũ không đổi một byte.
   */
  maskedStdout?: string
  /** Captured CLI session id (preset-uuid or parse-json providers). */
  sessionId?: string | null
  /** True when runProcess() killed the child after timeoutMs elapsed (SIGTERM).
   * Lets classifyJobFailure() recognize a timeout deterministically instead of
   * matching the CLI's own stdout/stderr text (e.g. Claude Code's interrupt
   * markers "Execution error" / "[Request interrupted by user]"). */
  timedOut?: boolean
  /** Optional token usage — persisted with `source: 'stdout'` (usageCapture.ts). */
  tokenUsage?: TokenUsage
}

/** Nguồn bản ghi usage — hợp đồng dữ liệu với statistics (#445). */
export type UsageSource = 'aggregate' | 'stdout'

/**
 * Đầu vào hook `captureUsage` — provider đọc usage từ nơi riêng của nó (vd
 * transcript CLI) rồi ghi qua `usageCapture.recordJobUsage` với
 * `provider = providerId`, `source = 'aggregate'`.
 */
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

// A provider plugs a concrete execution backend (e.g. the Claude Code CLI) into
// the runner plane behind a uniform contract.
//
// `family` / `acceptsAgent` / `mcpDelivery`: mọi hiện thực dựng sẵn đều khai;
// provider đăng ký lúc chạy (stub test) có thể bỏ — `registerProvider` bù theo
// bản dựng sẵn cùng id rồi luật theo id. Caller luôn nhận `RegisteredProvider`
// (đủ ba trường) qua `getProvider()`.
export interface RunnerProvider {
  providerId: string
  family?: ProviderFamily
  /** `false` ⇒ jobQueue chạy job không gắn agent (console-command). */
  acceptsAgent?: boolean
  /**
   * How this provider receives the job's MCP servers. Provider không nhận MCP
   * mang `NoMcpDelivery` (Null Object, catalog trả `'unsupported'`). Lắp ráp ở
   * `providerRegistry.ts`.
   */
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

/**
 * A chat round resumes the SAME agent's session (`sendTaskFeedback` copies
 * `agentRef` from the parent job), so the agent's instructions are already in
 * the conversation — re-sending the whole system prompt with every message is
 * pure noise and tokens.
 *
 * Keyed on `isChatFeedback` only, deliberately: that flag is stripped when
 * `advancePipelineStepChain` carries metadata into the next step, whereas
 * `parentJobId` leaks forward — and a pipeline step resuming the previous
 * step's session runs a DIFFERENT agent, whose instructions must be sent.
 */
export function shouldSendAgentInstructions(req: ExecuteRequest): boolean {
  return !(req.resumeSessionId && req.metadata?.isChatFeedback === true)
}
