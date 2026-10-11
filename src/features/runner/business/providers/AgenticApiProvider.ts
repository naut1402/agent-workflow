import { isDirectSecretType, resolveSecretRef } from '../credentials.js'
import { formatJobLogHeader } from '../jobLogFormat.js'
import { resolveProviderApiKey } from '../oauthCredentials.js'
import { mintSessionId } from '../sessionLedger.js'
import { appendTranscriptTurn, loadSessionMessages, saveSessionMessages } from './agentTranscriptStore.js'
import type { McpJobDelivery } from '../mcpDelivery/McpJobDelivery.js'
import { NoMcpDelivery } from '../mcpDelivery/NoMcpDelivery.js'
import type { McpToolBridge } from '../mcpDelivery/ToolBridgeMcpDelivery.js'
import type { CredentialProfile } from '../types.js'
import {
  shouldSendAgentInstructions,
  type CompletionRequest,
  type CompletionResult,
  type ExecuteRequest,
  type ExecuteResult,
  type ProviderCatalogInfo,
  type ProviderFamily,
  type RunnerProvider,
  type TokenUsage,
  type TranscriptFormat,
} from './RunnerProvider.js'
import { agentLabelOf, collectProducedArtifacts, createJobLogAppender, describeExecuteResult, jobLogHeaderMeta } from './providerJobReport.js'

/** Sent once when a turn comes back empty with no tool call. */
export const EMPTY_REPLY_NUDGE_TEXT =
  'Bạn vừa trả lời trống và không gọi tool nào. Nếu đã hoàn tất nhiệm vụ, hãy trả lời ' +
  'bằng một câu văn bản ngắn xác nhận. Nếu chưa, hãy gọi đúng 1 trong các tool đã được ' +
  'liệt kê ở đầu system prompt.'

/** Marker line printed right before the model's response in the job log. */
export const RUNNER_RESPONSE_MARKER = '\n=== Phản hồi của runner ===\n\n'

/** Error message when the turn after the nudge is still empty. */
export const EMPTY_REPLY_ERROR_MESSAGE =
  'model trả lời rỗng và không gọi tool sau khi đã nhắc lại — có thể model không tương thích tốt với bộ tool hiện tại qua provider này'

/** Thrown by `runConversation()` with the history so far, so `execute()` can persist it before failing. */
export class AgenticRunError extends Error {
  readonly partialMessages: unknown[]
  constructor(message: string, partialMessages: unknown[]) {
    super(message)
    this.name = 'AgenticRunError'
    this.partialMessages = partialMessages
  }
}

/** Result of one full turn of an API-based agentic conversation (tool-use loop included). */
export interface AgenticRunResult {
  finalText: string
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
  /** Pre-summarized so the base class never needs to know a subclass's tool schema. */
  toolCalls: Array<{ name: string; argsSummary: string; ok: boolean; resultSummary: string }>
  /** Opaque to the base class — persisted verbatim, handed back to the same subclass on resume. */
  rawMessages: unknown[]
}

/** Truncates a tool outcome to 200 chars for the job log. */
export function summarizeResult(outcome: unknown): string {
  try {
    const json = JSON.stringify(outcome)
    if (!json) return ''
    return json.length > 200 ? `${json.slice(0, 200)}…` : json
  } catch {
    return ''
  }
}

/**
 * Progress callbacks for `runConversation()`. A subclass that calls them must call
 * them for every tool call / assistant turn.
 */
export interface AgenticStreamHandlers {
  /** A tool call just finished — `ok`/`resultSummary` reflect the outcome. */
  onToolCall: (call: { name: string; argsSummary: string; ok: boolean; resultSummary: string }) => void
  /** Assistant text delta; the turn is committed to the transcript at `done` (default `true`). */
  onAssistantChunk: (text: string, opts?: { done?: boolean }) => void
  /** Called once, right after the system prompt is built. */
  onSystemPrompt: (system: string) => void
}

export interface AgenticRunContext {
  req: ExecuteRequest
  runnerConfig: Record<string, any>
  apiKey: string
  /** Loaded by the base class when `req.resumeSessionId` is set; [] for a fresh session. */
  priorMessages: unknown[]
  workspace: string
  /** Aborted on `cancelJob` — thread into fetch/SDK calls so cancelling stops the in-flight request. */
  signal?: AbortSignal
  /** Report tool calls / assistant text as they happen instead of only at the end — see `AgenticStreamHandlers`. */
  handlers: AgenticStreamHandlers
  /** Tool MCP của job, hoặc `null` khi Connection không bật server nào. */
  mcpBridge?: McpToolBridge | null
}

/** Đầu vào `completeOnce` — một lượt hỏi-đáp, key đã giải. */
export interface AgenticCompletionContext extends CompletionRequest {
  apiKey: string
  model: string
  baseURL?: string
}

// xem docs/architecture/code/runner.md §19
/** Common base for API-based agentic providers — subclasses implement `runConversation()` (and optionally `completeOnce()`). */
export abstract class AgenticApiProvider implements RunnerProvider {
  abstract readonly providerId: string
  readonly family: ProviderFamily = 'ai-api'
  readonly acceptsAgent = true
  /** Transcript runner tự ghi qua `agentTranscriptStore` — đọc lại bằng `agentTranscriptFile()`. */
  readonly transcriptFormat: TranscriptFormat = 'agent-sdk'
  /** Mô tả UI — hiện thực điền trong constructor khi được lắp ráp (providerRegistry.ts). */
  catalog?: ProviderCatalogInfo

  /** @param mcpDelivery nối tool MCP của job vào vòng tool-use; thiếu ⇒ `NoMcpDelivery`. */
  constructor(readonly mcpDelivery: McpJobDelivery<McpToolBridge> = new NoMcpDelivery()) {}

  /** The only method a subclass must implement — the model-specific tool-use loop. */
  protected abstract runConversation(ctx: AgenticRunContext): Promise<AgenticRunResult>

  /** Hook một lượt cho `complete()` — mặc định từ chối. */
  protected async completeOnce(_ctx: AgenticCompletionContext): Promise<{ text: string; usage?: TokenUsage }> {
    throw new Error('provider này không hỗ trợ gọi một lượt')
  }

  /** Model ids this provider's endpoint serves — the default rejects. */
  async listModels(_apiKey: string, _baseURL: string): Promise<string[]> {
    throw new Error('provider này không hỗ trợ liệt kê model')
  }

  validateCredential(profile: CredentialProfile | undefined): { ok: boolean; errors: string[] } {
    const auth = resolveSecretRef(profile)
    if (isDirectSecretType(auth.type)) return { ok: true, errors: [] }
    return {
      ok: false,
      errors: ['secretRef phải là env:VAR_NAME, stored:<id> (dán secret qua UI), hoặc oauth:<id> (Connect via browser) cho provider API-based'],
    }
  }

  validateRunnerConfig(_config: Record<string, unknown> | undefined): { ok: boolean; errors: string[] } {
    return { ok: true, errors: [] }
  }

  capabilities(): { supportsAgentFile: boolean; supportsStreaming: boolean; maxConcurrency: number } {
    return { supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }
  }

  private describePayload(req: ExecuteRequest, runnerConfig: Record<string, any>, sessionId: string): string {
    const meta = req.metadata || {}
    const lines = [
      formatJobLogHeader({
        jobId: String(meta.jobId || req.jobId || ''),
        providerId: this.providerId,
        ...jobLogHeaderMeta(meta),
        sessionId,
        resumeSessionId: req.resumeSessionId,
        workspace: req.workspace,
        mode: 'agentic-api',
      }).trimEnd(),
      '=== Payload gửi cho runner ===',
      `Agent: ${agentLabelOf(req.resolvedAgent)}`,
      `Workspace: ${req.workspace}`,
      `Provider: ${this.providerId}${runnerConfig.model ? ` — model: ${runnerConfig.model}` : ''}`,
      '--- Prompt ---',
      req.userPrompt,
    ]
    return lines.join('\n')
  }

  /** Một lượt hỏi-đáp ngoài job — không ghi log job, transcript hay session. */
  async complete(
    input: CompletionRequest,
    runnerConfig: Record<string, any>,
    credential: CredentialProfile,
  ): Promise<CompletionResult> {
    const key = await resolveProviderApiKey(credential, this.providerId)
    if ('error' in key) return { ok: false, error: key.error }
    try {
      const out = await this.completeOnce({
        ...input,
        apiKey: key.value,
        model: String(runnerConfig?.model || ''),
        baseURL: typeof runnerConfig?.baseURL === 'string' && runnerConfig.baseURL ? runnerConfig.baseURL : undefined,
      })
      return { ok: true, text: out.text, ...(out.usage ? { usage: out.usage } : {}) }
    } catch (err: any) {
      return { ok: false, error: String(err?.message ?? err) }
    }
  }

  async execute(req: ExecuteRequest, runnerConfig: Record<string, any>, credential: CredentialProfile): Promise<ExecuteResult> {
    const started = Date.now()
    const logPath = req.metadata?.logPath as string | undefined
    const appendLog = createJobLogAppender(logPath)

    const sessionId = req.resumeSessionId ?? req.sessionId ?? mintSessionId()
    appendLog(this.describePayload(req, runnerConfig, sessionId))

    const fail = (error: string): ExecuteResult => {
      const result: ExecuteResult = { ok: false, exitCode: null, durationMs: Date.now() - started, logPath, sessionId, error }
      appendLog(describeExecuteResult(result))
      return result
    }

    const key = await resolveProviderApiKey(credential, this.providerId)
    if ('error' in key) return fail(key.error)
    const apiKey = key.value

    const priorMessages = req.resumeSessionId ? loadSessionMessages(req.resumeSessionId) : []

    if (req.userPrompt?.trim()) {
      appendTranscriptTurn(this.providerId, sessionId, { role: 'user', text: req.userPrompt })
    }

    const stream = this.createStreamHandlers(req, sessionId, appendLog)

    // xem docs/architecture/code/runner.md §20
    const mcpBridge = await this.openMcpBridge(req, runnerConfig, appendLog)

    let result: AgenticRunResult
    try {
      result = await this.runConversation({
        req,
        runnerConfig,
        apiKey,
        priorMessages,
        workspace: req.workspace,
        signal: req.signal,
        handlers: stream.handlers,
        mcpBridge,
      })
    } catch (err: any) {
      stream.flushAssistantBuffer()
      if (err instanceof AgenticRunError && Array.isArray(err.partialMessages) && err.partialMessages.length) {
        saveSessionMessages(sessionId, err.partialMessages)
      }
      return fail(String(err?.message ?? err))
    } finally {
      await mcpBridge?.close().catch(() => {})
    }

    if (!stream.streamed()) this.replayResult(result, sessionId, appendLog)
    saveSessionMessages(sessionId, result.rawMessages)

    const artifactsFound = collectProducedArtifacts(req.workspace, req.produces)

    const final: ExecuteResult = {
      ok: true,
      exitCode: 0,
      durationMs: Date.now() - started,
      logPath,
      stdout: result.finalText,
      tokenUsage: result.usage,
      sessionId,
      artifactsFound,
    }
    appendLog(describeExecuteResult(final))
    return final
  }

  private recordToolCall(
    sessionId: string,
    call: AgenticRunResult['toolCalls'][number],
    appendLog: (text: string) => void,
  ): void {
    appendTranscriptTurn(this.providerId, sessionId, { role: 'tool', tool: call.name, text: call.argsSummary })
    const status = call.ok ? 'ok' : `FAIL: ${call.resultSummary}`
    appendLog(`[tool] ${call.name} ${call.argsSummary} → ${status}\n`)
  }

  private createStreamHandlers(
    req: ExecuteRequest,
    sessionId: string,
    appendLog: (text: string) => void,
  ): { handlers: AgenticStreamHandlers; flushAssistantBuffer: () => void; streamed: () => boolean } {
    let streamed = false
    let assistantBuffer = ''
    const flushAssistantBuffer = (): void => {
      const full = assistantBuffer
      assistantBuffer = ''
      if (full.trim()) {
        appendTranscriptTurn(this.providerId, sessionId, { role: 'assistant', text: full })
        appendLog('\n')
      }
    }
    const handlers: AgenticStreamHandlers = {
      onSystemPrompt: (system) => {
        if (!shouldSendAgentInstructions(req)) {
          appendLog(`--- System prompt (không đổi — đã gửi ở job trước của phiên này) ---${RUNNER_RESPONSE_MARKER}`)
          return
        }
        appendLog(`--- System prompt (đã gửi cho model) ---\n${system}\n${RUNNER_RESPONSE_MARKER}`)
      },
      onToolCall: (call) => {
        streamed = true
        this.recordToolCall(sessionId, call, appendLog)
      },
      onAssistantChunk: (text, opts) => {
        streamed = true
        if (text) appendLog(text)
        assistantBuffer += text
        if (opts?.done !== false) flushAssistantBuffer()
      },
    }
    return { handlers, flushAssistantBuffer, streamed: () => streamed }
  }

  private async openMcpBridge(
    req: ExecuteRequest,
    runnerConfig: Record<string, any>,
    appendLog: (text: string) => void,
  ): Promise<McpToolBridge | null> {
    let mcpBridge: McpToolBridge | null = null
    try {
      mcpBridge = await this.mcpDelivery.prepare({
        ids: runnerConfig?.mcpServers,
        workspace: req.workspace,
        jobId: req.jobId,
        metadata: req.metadata,
        onWarning: (message) => appendLog(`[runner] MCP warning: ${message}\n`),
      })
    } catch (err: any) {
      appendLog(`[runner] MCP warning: không mở được tool MCP — ${String(err?.message ?? err)}\n`)
    }
    if (mcpBridge) {
      appendLog(
        `[runner] MCP: ${mcpBridge.tools.length} tool từ server đã bật → vòng tool-use của ${this.providerId}\n`,
      )
    }
    return mcpBridge
  }

  private replayResult(result: AgenticRunResult, sessionId: string, appendLog: (text: string) => void): void {
    for (const call of result.toolCalls) this.recordToolCall(sessionId, call, appendLog)
    if (result.finalText?.trim()) {
      appendTranscriptTurn(this.providerId, sessionId, { role: 'assistant', text: result.finalText })
      appendLog(`${result.finalText}\n`)
    }
  }
}
