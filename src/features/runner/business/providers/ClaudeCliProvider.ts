import { captureClaudeTranscriptUsage } from '../claudeUsageTranscript.js'
import {
  AbstractAgentCliProvider,
  type AgentCliInvocation,
  type AgentCliInvocationContext,
  type AgentCliProviderOptions,
} from './AbstractAgentCliProvider.js'
import type { ProviderCatalogInfo, TranscriptFormat, UsageCaptureInput } from './RunnerProvider.js'

/** Static aliases — Claude CLI has no listModels API; user can still type a free-form id (creatable combo). */
const CLAUDE_CLI_MODELS = ['opus', 'sonnet', 'haiku']

export interface ClaudeInvocationInput {
  flags: string[]
  prompt: string
  allowedTools?: unknown
  dangerouslySkipPermissions?: unknown
  sessionId?: string
  resumeSessionId?: string
  model?: string
  /** Đường dẫn file JSON `mcpServers`; có giá trị mới sinh cờ `--mcp-config`. */
  mcpConfigPath?: string
}

export interface ClaudeInvocation {
  args: string[]
  stdinInput: string
}

/** Pure builder for the Claude headless (`claude -p`) invocation.
 *
 * The prompt is delivered on STDIN, never as an argv element: `-p` is a boolean
 * print-mode flag and `claude -p` reads the prompt from stdin. Keeping the
 * (multi-line, whitespace-containing) prompt out of argv is what fixes the
 * Windows bug where `spawn(..., { shell: true })` space-joins argv without
 * quoting and cmd.exe splits the prompt — leaving `claude -p` with only its
 * first token. Every remaining argv element is a flag or a flag value with no
 * embedded whitespace, so it survives shell:true argv-joining intact. */
export function buildClaudeInvocation(input: ClaudeInvocationInput): ClaudeInvocation {
  const args = [...input.flags, '-p']
  if (input.allowedTools) {
    args.push('--allowedTools', String(input.allowedTools))
  }
  if (input.dangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions')
  }
  // `--strict-mcp-config` đi kèm bắt buộc: không có nó, job còn ăn thêm MCP
  // server cấu hình sẵn trên máy chạy dashboard.
  if (input.mcpConfigPath) {
    args.push('--mcp-config', input.mcpConfigPath, '--strict-mcp-config')
  }
  if (input.model) {
    args.push('--model', input.model)
  }
  // Approval-flow session continuity — exactly one is ever set (see
  // ExecuteRequest.sessionId/resumeSessionId doc comment).
  if (input.sessionId) args.push('--session-id', input.sessionId)
  if (input.resumeSessionId) args.push('--resume', input.resumeSessionId)
  return { args, stdinInput: input.prompt }
}

/**
 * Claude Code CLI (`claude -p`) — prompt qua stdin, session id đặt trước
 * (`--session-id`), MCP qua `--mcp-config`, usage đọc lại từ transcript CLI tự ghi.
 */
export class ClaudeCliProvider extends AbstractAgentCliProvider {
  readonly providerId = 'claude-code-cli'
  readonly catalog: ProviderCatalogInfo = {
    kind: 'local-console',
    label: 'Claude Code CLI',
    modelListing: 'static',
    supportsAllowedTools: true,
    localCommand: { id: 'claude', command: 'claude', match: { base: '^claude$' } },
  }
  override readonly transcriptFormat: TranscriptFormat = 'claude-projects'
  protected override readonly supportsAgentFile = true

  constructor(opts: AgentCliProviderOptions = {}) {
    super({ defaultCliPath: 'claude', sessionCapture: 'preset-uuid' }, opts)
  }

  protected buildInvocation(ctx: AgentCliInvocationContext): AgentCliInvocation {
    const { runnerConfig } = ctx
    // Headless `-p` with no TTY will hang forever if Claude waits for an
    // interactive tool-permission prompt. Default skip-permissions on unless
    // the runner config explicitly sets dangerouslySkipPermissions: false.
    const skipPermissions =
      runnerConfig.dangerouslySkipPermissions !== false &&
      runnerConfig.dangerouslySkipPermissions !== 'false'
    return buildClaudeInvocation({
      flags: ctx.flags,
      prompt: ctx.prompt,
      allowedTools: runnerConfig.allowedTools,
      dangerouslySkipPermissions: skipPermissions,
      sessionId: ctx.sessionPlan.sessionId,
      resumeSessionId: ctx.sessionPlan.resumeSessionId,
      model: runnerConfig.model,
      // 📌 Chỉ cách giao bằng cờ mới đẩy đường dẫn vào argv. Cách giao qua file
      // workspace dùng cùng kiểu handle nhưng CLI tự đọc theo cwd — đẩy vào là argv sai.
      mcpConfigPath: ctx.mcpHandle?.kind === 'config-file-flag' ? ctx.mcpHandle.path : undefined,
    })
  }

  async listModels(_apiKey: string, _baseURL: string): Promise<string[]> {
    return CLAUDE_CLI_MODELS
  }

  /** Usage của Claude nằm trong transcript CLI tự ghi — ghi `source: 'aggregate'`. */
  async captureUsage(input: UsageCaptureInput): Promise<void> {
    await captureClaudeTranscriptUsage(input.job, input.sessionId, this.providerId)
  }
}
