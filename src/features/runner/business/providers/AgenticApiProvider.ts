import { appendTextFileSync, existsSync, joinPath } from '../../../../backend/lib/fileHelper.js'
import { isDirectSecretType, resolveSecretRef } from '../credentials.js'
import { formatJobLogFooter, formatJobLogHeader } from '../jobLogFormat.js'
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

/** Sent once when a turn comes back empty with no tool call — gives the model one chance to self-correct before the loop fails the job. */
export const EMPTY_REPLY_NUDGE_TEXT =
  'Bạn vừa trả lời trống và không gọi tool nào. Nếu đã hoàn tất nhiệm vụ, hãy trả lời ' +
  'bằng một câu văn bản ngắn xác nhận. Nếu chưa, hãy gọi đúng 1 trong các tool đã được ' +
  'liệt kê ở đầu system prompt.'

/** Marker line reprinted right before the model's response in the job log — emitted by `onSystemPrompt` (see execute()). */
export const RUNNER_RESPONSE_MARKER = '\n=== Phản hồi của runner ===\n\n'

/** Thrown when the turn after the nudge is still empty — surfaces as a clear `ok:false` instead of a silent `succeeded`. */
export const EMPTY_REPLY_ERROR_MESSAGE =
  'model trả lời rỗng và không gọi tool sau khi đã nhắc lại — có thể model không tương thích tốt với bộ tool hiện tại qua provider này'

/**
 * Thrown by `runConversation()` instead of a plain `Error` once `messages` has
 * accumulated any history worth keeping (system prompt, tool calls, partial
 * turns) — lets `execute()` persist that history via `saveSessionMessages()`
 * before surfacing the failure, so a resume after a mid-conversation error
 * doesn't start from an empty session.
 */
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

/** Same truncation rule as `summarize()`/`summarizeArgs()` (200 chars) — keeps a large tool outcome (e.g. `search_files` matches) from blowing up the job log. */
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
 * Lets `runConversation()` surface progress as it happens instead of the base
 * class only seeing the final `AgenticRunResult` once the whole tool-use loop
 * is done. A subclass that calls these opts out of the base class's legacy
 * "write everything from the returned result" fallback (see `execute()`) —
 * call them for every tool call / assistant turn, not just some.
 */
export interface AgenticStreamHandlers {
  /** A tool call just finished executing this turn — `ok`/`resultSummary` reflect the outcome, not just the call. */
  onToolCall: (call: { name: string; argsSummary: string; ok: boolean; resultSummary: string }) => void
  /**
   * Assistant text became available. `text` is a delta to append, not the
   * full turn so far — callers that don't have real token streaming just
   * call this once per turn with the whole turn text (`done` defaults to
   * `true`). A future streaming subclass calls it many times per turn with
   * `done: false`, then once more with the trailing delta (or `''`) and
   * `done: true` — the base class buffers deltas and only commits a
   * transcript turn (one JSONL line / chat bubble) at `done`, while still
   * tailing every delta into the raw job log immediately.
   */
  onAssistantChunk: (text: string, opts?: { done?: boolean }) => void
  /** Called exactly once by `runConversation()`, right after the system prompt is built — before the first model call. */
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
  /**
   * Tool MCP của job này, hoặc `null` khi Connection không bật server nào.
   * `null` là đường mặc định: subclass phải dựng `tools` và preamble y hệt bản
   * trước khi có bridge — xem `buildToolUsagePreamble`.
   */
  mcpBridge?: McpToolBridge | null
}

/** Đầu vào `completeOnce` — một lượt hỏi-đáp, key đã giải. */
export interface AgenticCompletionContext extends CompletionRequest {
  apiKey: string
  model: string
  baseURL?: string
}

/**
 * Common base for API-based agentic providers (openai/gemini/xai/anthropic —
 * "call the model over HTTP, let it read/write files via tools", as opposed to
 * spawning a CLI subprocess). Subclasses implement only `runConversation()`
 * (how to call the model + how tool schemas map to the sandbox operations in
 * `agenticWorkspaceTools.ts`) and, optionally, `completeOnce()`; everything
 * else — API-key resolution (`resolveProviderApiKey`), session load/save,
 * transcript bookkeeping and the `RunnerProvider` contract — is written once here.
 */
export abstract class AgenticApiProvider implements RunnerProvider {
  abstract readonly providerId: string
  readonly family: ProviderFamily = 'ai-api'
  readonly acceptsAgent = true
  /** Transcript runner tự ghi qua `agentTranscriptStore` — đọc lại bằng `agentTranscriptFile()`. */
  readonly transcriptFormat: TranscriptFormat = 'agent-sdk'
  /** Mô tả UI — hiện thực điền trong constructor khi được lắp ráp (providerRegistry.ts). */
  catalog?: ProviderCatalogInfo

  /**
   * @param mcpDelivery nối tool MCP của job vào vòng tool-use — lắp ráp ở
   *   `providerRegistry.ts` (`ToolBridgeMcpDelivery`). Thiếu ⇒ `NoMcpDelivery`: bridge
   *   luôn `null`, `tools` và preamble y hệt bản trước khi có MCP.
   */
  constructor(readonly mcpDelivery: McpJobDelivery<McpToolBridge> = new NoMcpDelivery()) {}

  /** The only method a subclass must implement — the model-specific tool-use loop. */
  protected abstract runConversation(ctx: AgenticRunContext): Promise<AgenticRunResult>

  /**
   * Hook một lượt cho `complete()` — gọi model một lần, không tool, không
   * session. Hiện thực SDK override; mặc định từ chối để caller nhận lý do rõ.
   */
  protected async completeOnce(_ctx: AgenticCompletionContext): Promise<{ text: string; usage?: TokenUsage }> {
    throw new Error('provider này không hỗ trợ gọi một lượt')
  }

  /**
   * Fetch the model ids this provider's endpoint currently serves, so
   * ConnectionDialog can offer them instead of a free-text guess. Optional —
   * override in a subclass whose SDK exposes a models-list endpoint; the
   * default rejects so callers get a clear reason instead of a silent [].
   */
  async listModels(_apiKey: string, _baseURL: string): Promise<string[]> {
    throw new Error('provider này không hỗ trợ liệt kê model')
  }

  // ---- RunnerProvider contract, shared by every subclass ----

  validateCredential(profile: CredentialProfile | undefined): { ok: boolean; errors: string[] } {
    const auth = resolveSecretRef(profile)
    if (isDirectSecretType(auth.type)) return { ok: true, errors: [] }
    return {
      ok: false,
      errors: ['secretRef phải là env:VAR_NAME, stored:<id> (dán secret qua UI), hoặc oauth:<id> (Connect via browser) cho provider API-based'],
    }
  }

  validateRunnerConfig(_config: Record<string, unknown> | undefined): { ok: boolean; errors: string[] } {
    // model/baseURL are optional — a connection with no model picked yet is valid
    // (the future model-rotation feature is expected to fill it in at execute time).
    return { ok: true, errors: [] }
  }

  capabilities(): { supportsAgentFile: boolean; supportsStreaming: boolean; maxConcurrency: number } {
    return { supportsAgentFile: false, supportsStreaming: false, maxConcurrency: 1 }
  }

  // ---- Job-log framing — mirrors the CLI providers' logPath convention so the
  // Logs panel is not empty just because this provider never spawns a subprocess. ----

  private describePayload(req: ExecuteRequest, runnerConfig: Record<string, any>, sessionId: string): string {
    const agent = req.resolvedAgent
    const agentLabel = agent.ref
      ? `${agent.ref}${agent.name ? ` (${agent.name})` : ''}`
      : `${agent.name || 'ad-hoc'} — không gắn agent, chạy prompt trực tiếp`
    const meta = req.metadata || {}
    const lines = [
      formatJobLogHeader({
        jobId: String(meta.jobId || req.jobId || ''),
        providerId: this.providerId,
        runnerId: typeof meta.runnerId === 'string' ? meta.runnerId : undefined,
        connectionId: typeof meta.connectionId === 'string' ? meta.connectionId : undefined,
        projectId: typeof meta.projectId === 'string' ? meta.projectId : undefined,
        taskId: typeof meta.taskId === 'string' ? meta.taskId : undefined,
        stepId:
          typeof meta.stepId === 'string'
            ? meta.stepId
            : typeof meta.pipelineStepId === 'string'
              ? meta.pipelineStepId
              : undefined,
        sessionId,
        resumeSessionId: req.resumeSessionId,
        workspace: req.workspace,
        mode: 'agentic-api',
      }).trimEnd(),
      '=== Payload gửi cho runner ===',
      `Agent: ${agentLabel}`,
      `Workspace: ${req.workspace}`,
      `Provider: ${this.providerId}${runnerConfig.model ? ` — model: ${runnerConfig.model}` : ''}`,
      '--- Prompt ---',
      req.userPrompt,
    ]
    return lines.join('\n')
  }

  private describeResult(result: ExecuteResult): string {
    return formatJobLogFooter({
      ok: result.ok,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      sessionId: result.sessionId,
      error: result.error,
      artifactsFound: result.artifactsFound,
      tokenUsage: result.tokenUsage,
    })
  }

  /**
   * Một lượt hỏi-đáp ngoài job (vd sinh bản nháp agent): key giải như
   * `execute()`, model / baseURL lấy từ cấu hình Connection. Không ghi log job,
   * transcript hay session.
   */
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

  // ---- Template method — fixed for every subclass, delegates to runConversation() ----

  async execute(req: ExecuteRequest, runnerConfig: Record<string, any>, credential: CredentialProfile): Promise<ExecuteResult> {
    const started = Date.now()
    const logPath = req.metadata?.logPath as string | undefined
    const appendLog = (text: string) => {
      if (!logPath) return
      try {
        appendTextFileSync(logPath, text)
      } catch {
        /* ignore */
      }
    }

    const sessionId = req.resumeSessionId ?? req.sessionId ?? mintSessionId()
    appendLog(this.describePayload(req, runnerConfig, sessionId))

    const key = await resolveProviderApiKey(credential, this.providerId)
    if ('error' in key) {
      const result: ExecuteResult = { ok: false, exitCode: null, durationMs: Date.now() - started, logPath, sessionId, error: key.error }
      appendLog(this.describeResult(result))
      return result
    }
    const apiKey = key.value

    const priorMessages = req.resumeSessionId ? loadSessionMessages(req.resumeSessionId) : []

    if (req.userPrompt?.trim()) {
      appendTranscriptTurn(this.providerId, sessionId, { role: 'user', text: req.userPrompt })
    }

    // Streamed as `runConversation()` progresses (see `AgenticStreamHandlers`)
    // instead of only once at the very end. `streamed` tracks whether the
    // subclass actually used these — if it never calls them (e.g. the older,
    // non-streaming shape), `execute()` falls back to writing everything from
    // the returned `result` in one shot below, exactly as before.
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
        appendTranscriptTurn(this.providerId, sessionId, { role: 'tool', tool: call.name, text: call.argsSummary })
        const status = call.ok ? 'ok' : `FAIL: ${call.resultSummary}`
        appendLog(`[tool] ${call.name} ${call.argsSummary} → ${status}\n`)
      },
      onAssistantChunk: (text, opts) => {
        streamed = true
        if (text) appendLog(text)
        assistantBuffer += text
        if (opts?.done !== false) flushAssistantBuffer()
      },
    }

    // Mở TRƯỚC vòng hội thoại và đóng trong `finally` của cùng khối: transport
    // stdio là tiến trình con, nên một đường thoát quên `close()` là rò tiến
    // trình theo từng job. Mở hụt 🚫 không làm hỏng job — chỉ mất tool.
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

    let result: AgenticRunResult
    try {
      result = await this.runConversation({
        req,
        runnerConfig,
        apiKey,
        priorMessages,
        workspace: req.workspace,
        signal: req.signal,
        handlers,
        mcpBridge,
      })
    } catch (err: any) {
      flushAssistantBuffer() // don't lose a partially-streamed turn if the loop threw mid-turn
      // `.length` guard: avoid overwriting an already-persisted session with `[]`
      // if some future throw site forgets to pass a full `messages` array.
      if (err instanceof AgenticRunError && Array.isArray(err.partialMessages) && err.partialMessages.length) {
        saveSessionMessages(sessionId, err.partialMessages)
      }
      const failure: ExecuteResult = {
        ok: false,
        exitCode: null,
        durationMs: Date.now() - started,
        logPath,
        sessionId,
        error: String(err?.message ?? err),
      }
      appendLog(this.describeResult(failure))
      return failure
    } finally {
      await mcpBridge?.close().catch(() => {})
    }

    if (!streamed) {
      for (const call of result.toolCalls) {
        appendTranscriptTurn(this.providerId, sessionId, { role: 'tool', tool: call.name, text: call.argsSummary })
        const status = call.ok ? 'ok' : `FAIL: ${call.resultSummary}`
        appendLog(`[tool] ${call.name} ${call.argsSummary} → ${status}\n`)
      }
      if (result.finalText?.trim()) {
        appendTranscriptTurn(this.providerId, sessionId, { role: 'assistant', text: result.finalText })
        appendLog(`${result.finalText}\n`)
      }
    }
    saveSessionMessages(sessionId, result.rawMessages)

    const artifactsFound = (req.produces ?? []).filter((name) => existsSync(joinPath(req.workspace, name)))

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
    appendLog(this.describeResult(final))
    return final
  }
}
