import {
  appendTextFileSync,
  dirname,
  existsSync,
  joinPath,
  mkdirSync,
  readTextFileSync,
  readdirSync,
  resolvePathUnder,
  writeTextFileSync,
} from '../../../../core/lib/fileHelper.js'
import { isDirectSecretType, resolveSecretRef } from '../credentials.js'
import { formatJobLogFooter, formatJobLogHeader } from '../jobLogFormat.js'
import { ensureFreshOAuthToken } from '../oauthCredentials.js'
import { mintSessionId } from '../sessionLedger.js'
import { appendTranscriptTurn, loadSessionMessages, saveSessionMessages } from './agentTranscriptStore.js'
import type { CredentialProfile, ExecuteRequest, ExecuteResult, ProviderFamily, RunnerProvider } from '../types.js'

/** Result of one full turn of an API-based agentic conversation (tool-use loop included). */
export interface AgenticRunResult {
  finalText: string
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
  /** Pre-summarized so the base class never needs to know a subclass's tool schema. */
  toolCalls: Array<{ name: string; argsSummary: string }>
  /** Opaque to the base class — persisted verbatim, handed back to the same subclass on resume. */
  rawMessages: unknown[]
}

/**
 * Lets `runConversation()` surface progress as it happens instead of the base
 * class only seeing the final `AgenticRunResult` once the whole tool-use loop
 * is done. A subclass that calls these opts out of the base class's legacy
 * "write everything from the returned result" fallback (see `execute()`) —
 * call them for every tool call / assistant turn, not just some.
 */
export interface AgenticStreamHandlers {
  /** A tool call just finished executing this turn. */
  onToolCall: (call: { name: string; argsSummary: string }) => void
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
}

interface SandboxOk {
  ok: true
}
interface SandboxErr {
  ok: false
  error: string
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let from = 0
  for (;;) {
    const idx = haystack.indexOf(needle, from)
    if (idx < 0) break
    count++
    from = idx + needle.length
  }
  return count
}

/**
 * Common base for API-based agentic providers (openai/gemini/xai/anthropic —
 * "call the model over HTTP, let it read/write files via tools", as opposed to
 * spawning a CLI subprocess). Subclasses implement only `runConversation()`
 * (how to call the model + how tool schemas map to the 4 sandbox operations
 * below); everything else — credential/API-key resolution, session load/save,
 * transcript bookkeeping, path-sandboxed file ops, and the `RunnerProvider`
 * contract — is written once here.
 */
export abstract class AgenticApiProvider implements RunnerProvider {
  abstract readonly providerId: string
  readonly family: ProviderFamily = 'ai-api'

  /** The only method a subclass must implement — the model-specific tool-use loop. */
  protected abstract runConversation(ctx: AgenticRunContext): Promise<AgenticRunResult>

  /**
   * Fetch the model ids this provider's endpoint currently serves, so
   * ConnectionDialog can offer them instead of a free-text guess. Optional —
   * override in a subclass whose SDK exposes a models-list endpoint; the
   * default rejects so callers get a clear reason instead of a silent [].
   */
  async listModels(_apiKey: string, _baseURL: string): Promise<string[]> {
    throw new Error('provider này không hỗ trợ liệt kê model')
  }

  // ---- Sandbox file-ops, shared by every subclass's tool implementations ----

  protected readWorkspaceFile(workspace: string, path: string): SandboxOk & { content: string } | SandboxErr {
    const p = resolvePathUnder(workspace, path)
    if (!p) return { ok: false, error: 'path outside workspace' }
    try {
      return { ok: true, content: readTextFileSync(p) }
    } catch (err: any) {
      return { ok: false, error: String(err?.message ?? err) }
    }
  }

  protected writeWorkspaceFile(workspace: string, path: string, content: string): SandboxOk | SandboxErr {
    const p = resolvePathUnder(workspace, path)
    if (!p) return { ok: false, error: 'path outside workspace' }
    try {
      mkdirSync(dirname(p), { recursive: true })
      writeTextFileSync(p, content)
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: String(err?.message ?? err) }
    }
  }

  protected editWorkspaceFile(workspace: string, path: string, oldStr: string, newStr: string): SandboxOk | SandboxErr {
    const p = resolvePathUnder(workspace, path)
    if (!p) return { ok: false, error: 'path outside workspace' }
    if (!oldStr) return { ok: false, error: 'old_string is required' }
    let base: string
    try {
      base = readTextFileSync(p)
    } catch (err: any) {
      return { ok: false, error: String(err?.message ?? err) }
    }
    const occurrences = countOccurrences(base, oldStr)
    if (occurrences === 0) return { ok: false, error: 'old_string not found' }
    if (occurrences > 1) return { ok: false, error: 'old_string not unique' }
    try {
      writeTextFileSync(p, base.replace(oldStr, newStr))
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: String(err?.message ?? err) }
    }
  }

  protected listWorkspaceDirectory(workspace: string, path?: string): (SandboxOk & { entries: string[] }) | SandboxErr {
    const p = resolvePathUnder(workspace, path ?? '.')
    if (!p) return { ok: false, error: 'path outside workspace' }
    try {
      return { ok: true, entries: readdirSync(p) }
    } catch (err: any) {
      return { ok: false, error: String(err?.message ?? err) }
    }
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
    // model/baseURL are optional here — enforced (model required) at ConnectionDialog save time.
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
      `Agent: ${agentLabel}${agent.model ? ` — model: ${agent.model}` : ''}`,
      `Workspace: ${req.workspace}`,
      `Provider: ${this.providerId}${runnerConfig.model ? ` — model: ${runnerConfig.model}` : ''}`,
      '--- Prompt ---',
      req.userPrompt,
      '',
      '=== Phản hồi của runner ===',
      '',
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

    const auth = resolveSecretRef(credential)
    let apiKey: string
    if (auth.type === 'oauth') {
      const fresh = await ensureFreshOAuthToken(credential.secretRef.slice('oauth:'.length), this.providerId)
      if ('error' in fresh) {
        const result: ExecuteResult = { ok: false, exitCode: null, durationMs: Date.now() - started, logPath, sessionId, error: fresh.error }
        appendLog(this.describeResult(result))
        return result
      }
      apiKey = fresh.value
    } else if ((auth.type === 'env' || auth.type === 'stored') && auth.value) {
      apiKey = auth.value
    } else {
      const result: ExecuteResult = {
        ok: false,
        exitCode: null,
        durationMs: Date.now() - started,
        logPath,
        sessionId,
        error: 'missing API key — secretRef phải là env:VAR_NAME, stored:<id>, hoặc oauth:<id>',
      }
      appendLog(this.describeResult(result))
      return result
    }

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
      onToolCall: (call) => {
        streamed = true
        appendTranscriptTurn(this.providerId, sessionId, { role: 'tool', tool: call.name, text: call.argsSummary })
        appendLog(`[tool] ${call.name} ${call.argsSummary}\n`)
      },
      onAssistantChunk: (text, opts) => {
        streamed = true
        if (text) appendLog(text)
        assistantBuffer += text
        if (opts?.done !== false) flushAssistantBuffer()
      },
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
      })
    } catch (err: any) {
      flushAssistantBuffer() // don't lose a partially-streamed turn if the loop threw mid-turn
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
    }

    if (!streamed) {
      for (const call of result.toolCalls) {
        appendTranscriptTurn(this.providerId, sessionId, { role: 'tool', tool: call.name, text: call.argsSummary })
        appendLog(`[tool] ${call.name} ${call.argsSummary}\n`)
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
