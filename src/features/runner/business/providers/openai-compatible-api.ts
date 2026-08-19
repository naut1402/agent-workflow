import OpenAI from 'openai'
import {
  AgenticApiProvider,
  AgenticRunError,
  EMPTY_REPLY_ERROR_MESSAGE,
  EMPTY_REPLY_NUDGE_TEXT,
  SHELL_ALLOWLIST,
  type AgenticRunContext,
  type AgenticRunResult,
  type ExtraTool,
} from './agenticApiProvider.js'

/** Chặn vòng lặp vô hạn khi model liên tục gọi tool — mirror anthropic-compatible-api. */
const MAX_AGENT_LOOP_TURNS = 8

/** One-line summary of tool args for the transcript — mirrors sessionTranscript.ts's describeToolUse. */
function summarizeArgs(args: unknown): string {
  try {
    const json = typeof args === 'string' ? args : JSON.stringify(args)
    if (!json) return ''
    return json.length > 200 ? `${json.slice(0, 200)}…` : json
  } catch {
    return ''
  }
}

const BASE_TOOLS: OpenAI.Chat.Completions.ChatCompletionFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a text file under the workspace.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'File path relative to the workspace.' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write (create or overwrite) a text file under the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to the workspace.' },
          content: { type: 'string', description: 'Full file content to write.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Replace one unique occurrence of old_string with new_string in a workspace file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to the workspace.' },
          old_string: { type: 'string' },
          new_string: { type: 'string' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List entries of a directory under the workspace.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Directory path relative to the workspace, defaults to "."' } },
      },
    },
  },
]

/**
 * Base 4 file-ops always registered; `extraTools` (from `Connection.config.extraTools`,
 * default `[]`) opts a Connection into shell/git/search/web on top — see agenticApiProvider.ts.
 * `webSearchConfigured` additionally gates `web_search` alone so an unconfigured
 * `BRAVE_SEARCH_API_KEY` hides the tool instead of registering one that always errors.
 */
function buildTools(extraTools: ExtraTool[], webSearchConfigured: boolean): OpenAI.Chat.Completions.ChatCompletionFunctionTool[] {
  const tools: OpenAI.Chat.Completions.ChatCompletionFunctionTool[] = [...BASE_TOOLS]
  if (extraTools.includes('shell')) {
    tools.push({
      type: 'function',
      function: {
        name: 'run_command',
        description: `Run a shell command in the workspace. Only these binaries are allowed: ${SHELL_ALLOWLIST.join(', ')}.`,
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Binary to run — must be in the allowlist.' },
            args: { type: 'array', items: { type: 'string' }, description: 'Argument list, passed verbatim (no shell interpretation).' },
          },
          required: ['command'],
        },
      },
    })
  }
  if (extraTools.includes('git')) {
    tools.push(
      {
        type: 'function',
        function: { name: 'git_status', description: 'Show git status (porcelain) of the workspace.', parameters: { type: 'object', properties: {} } },
      },
      {
        type: 'function',
        function: {
          name: 'git_diff',
          description: 'Show git diff of the workspace or a single file.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path relative to the workspace (optional).' },
              staged: { type: 'boolean', description: 'Diff staged changes instead of the working tree.' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'git_log',
          description: 'Show recent commit log (oneline, capped at 50).',
          parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Max commits to show (1-50, default 20).' } } },
        },
      },
    )
  }
  if (extraTools.includes('search')) {
    tools.push({
      type: 'function',
      function: {
        name: 'search_files',
        description: 'Search for a literal substring (not a regex) across text files in the workspace.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Literal substring to search for.' },
            path: { type: 'string', description: 'Directory to search under, relative to the workspace (optional).' },
          },
          required: ['pattern'],
        },
      },
    })
  }
  if (extraTools.includes('web')) {
    if (webSearchConfigured) {
      tools.push({
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search the web (Brave Search), returns up to 5 results.',
          parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        },
      })
    }
    tools.push({
      type: 'function',
      function: {
        name: 'fetch_url',
        description: 'Fetch the text content of a public https URL (private/loopback hosts are blocked).',
        parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      },
    })
  }
  return tools
}

/**
 * `openai-api` / `gemini-api` / `xai-api` — all expose an OpenAI-compatible
 * Chat Completions endpoint, so one wrapper (differing only in `defaultBaseURL`)
 * covers the group. The tool-use loop is driven directly against the `openai`
 * SDK rather than `@openai/agents`: that SDK's Chat Completions converter emits
 * non-spec fields on the follow-up request (the raw tool_call's `type`/`function`
 * flattened onto the assistant message, plus OpenAI-only `strict: true`), which
 * strict OpenAI-compat backends such as Gemini's reject — breaking every
 * tool-calling turn after the first. Driving the SDK directly keeps the wire
 * format exactly to spec (and per-call clients avoid shared global state).
 */
export class OpenAiCompatibleProvider extends AgenticApiProvider {
  readonly providerId: string
  private readonly defaultBaseURL: string

  constructor(providerId: string, defaultBaseURL: string) {
    super()
    this.providerId = providerId
    this.defaultBaseURL = defaultBaseURL
  }

  async listModels(apiKey: string, baseURL: string): Promise<string[]> {
    const client = new OpenAI({ baseURL: baseURL || this.defaultBaseURL, apiKey })
    const page = await client.models.list()
    const ids: string[] = []
    for await (const m of page) ids.push(m.id)
    return ids.sort()
  }

  protected async runConversation(ctx: AgenticRunContext): Promise<AgenticRunResult> {
    const model = String(ctx.runnerConfig.model || '')
    if (!model) throw new Error('model is required — set it on the runner connection (ConnectionDialog)')

    const timeoutMs = Number(ctx.req.timeoutMs) || Number(ctx.runnerConfig.timeoutMs) || 600_000
    const client = new OpenAI({ baseURL: ctx.runnerConfig.baseURL || this.defaultBaseURL, apiKey: ctx.apiKey, timeout: timeoutMs })

    const extraTools = this.resolveExtraTools(ctx.runnerConfig)
    const tools = buildTools(extraTools, this.isWebSearchConfigured())
    const systemContent = [
      this.buildToolUsagePreamble(tools.map((t) => t.function.name)),
      this.buildProjectContextPreamble(ctx.req),
      ctx.req.resolvedAgent.systemPrompt || '',
    ]
      .filter(Boolean)
      .join('\n\n')

    // `messages` excludes the system prompt — it is re-prepended on every turn
    // so the persisted rawMessages stay resume-ready without duplicating it.
    const priorMessages = (ctx.priorMessages ?? []) as OpenAI.Chat.Completions.ChatCompletionMessageParam[]
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = priorMessages.length
      ? [...priorMessages, { role: 'user', content: ctx.req.userPrompt }]
      : [{ role: 'user', content: ctx.req.userPrompt }]

    const toolCalls: AgenticRunResult['toolCalls'] = []
    const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    let hasNudgedEmptyReply = false

    for (let turn = 1; turn <= MAX_AGENT_LOOP_TURNS; turn++) {
      let response: OpenAI.Chat.Completions.ChatCompletion
      try {
        response = await client.chat.completions.create(
          {
            model,
            messages: [
              { role: 'system', content: systemContent },
              ...messages,
            ],
            tools,
          },
          { signal: ctx.signal },
        )
      } catch (err: any) {
        throw new AgenticRunError(
          `gọi LLM thất bại (có thể do timeout sau ${timeoutMs}ms hoặc response upstream không hợp lệ): ${String(err?.message ?? err)}`,
          messages,
        )
      }

      usage.inputTokens += response.usage?.prompt_tokens ?? 0
      usage.outputTokens += response.usage?.completion_tokens ?? 0
      usage.totalTokens += response.usage?.total_tokens ?? 0

      // Some OpenAI-compat gateways (e.g. OpenRouter free-tier models under
      // load/rate-limit) answer 200 OK with an `error` field and no `choices`
      // instead of a non-2xx status, so the SDK never throws. Surface that
      // clearly instead of crashing on `choices[0]` of an empty array.
      const gatewayError = (response as { error?: { message?: string; code?: unknown } }).error
      if (gatewayError) {
        throw new AgenticRunError(
          gatewayError.message ? String(gatewayError.message) : `provider trả lỗi: ${JSON.stringify(gatewayError)}`,
          messages,
        )
      }
      if (!response.choices?.length) {
        throw new AgenticRunError('provider trả về response không có choices (rate limit / model quá tải / lỗi upstream)', messages)
      }

      const message = response.choices[0]?.message
      // Only function tool calls exist in this provider's toolset; filter keeps
      // the union narrowed to the spec shape we echo back below.
      const calls = (message?.tool_calls ?? []).filter(
        (call): call is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
          call.type === 'function',
      )
      // Surface this turn's text as soon as it arrives — whether or not tool
      // calls follow — instead of only the final no-tool-call turn (level-1
      // streaming; see AgenticStreamHandlers). Not a real per-token delta
      // (this SDK call isn't `stream: true`), so one call covers the whole turn.
      const turnText = typeof message?.content === 'string' ? message.content : ''
      if (turnText) ctx.handlers.onAssistantChunk(turnText, { done: true })

      if (!calls.length) {
        if (turnText.trim()) {
          // Include the final reply in the persisted history so a resumed session
          // sees the model's own last answer.
          messages.push({ role: 'assistant', content: turnText })
          return { finalText: turnText, usage, toolCalls, rawMessages: messages }
        }

        // Empty content + no tool call — the model may not understand this
        // provider's toolset. Give it exactly one nudge before treating this
        // as a real failure instead of silently reporting job success (see
        // agenticApiProvider.ts's EMPTY_REPLY_NUDGE_TEXT for rationale).
        if (!hasNudgedEmptyReply) {
          hasNudgedEmptyReply = true
          messages.push({ role: 'assistant', content: '' })
          messages.push({ role: 'user', content: EMPTY_REPLY_NUDGE_TEXT })
          continue
        }
        throw new AgenticRunError(EMPTY_REPLY_ERROR_MESSAGE, messages)
      }

      // Rebuild the assistant message with only spec fields — echoing the
      // provider's raw message object verbatim can carry extra fields that
      // strict OpenAI-compat backends reject.
      messages.push({
        role: 'assistant',
        content: message?.content ?? null,
        tool_calls: calls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.function.name, arguments: call.function.arguments },
        })),
      })
      for (const call of calls) {
        const outcome = await this.executeTool(call, ctx.workspace)
        const entry = { name: call.function.name, argsSummary: summarizeArgs(call.function.arguments) }
        toolCalls.push(entry)
        ctx.handlers.onToolCall(entry)
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(outcome) })
      }
    }
    throw new AgenticRunError(`exceeded ${MAX_AGENT_LOOP_TURNS} agent loop turns`, messages)
  }

  /** Map one chat-completions function tool call onto a base-class sandbox op. */
  private async executeTool(call: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall, workspace: string) {
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(call.function.arguments || '{}')
    } catch {
      return { ok: false, error: 'invalid tool arguments JSON' }
    }
    const path = typeof args.path === 'string' ? args.path : ''
    switch (call.function.name) {
      case 'read_file':
        return this.readWorkspaceFile(workspace, path)
      case 'write_file':
        return this.writeWorkspaceFile(workspace, path, typeof args.content === 'string' ? args.content : '')
      case 'edit_file':
        return this.editWorkspaceFile(
          workspace,
          path,
          typeof args.old_string === 'string' ? args.old_string : '',
          typeof args.new_string === 'string' ? args.new_string : '',
        )
      case 'list_directory':
        return this.listWorkspaceDirectory(workspace, typeof args.path === 'string' ? args.path : undefined)
      case 'run_command': {
        const command = typeof args.command === 'string' ? args.command : ''
        const cmdArgs = Array.isArray(args.args) ? args.args.filter((a): a is string => typeof a === 'string') : []
        return this.runShellCommand(workspace, command, cmdArgs)
      }
      case 'git_status':
        return this.gitStatus(workspace)
      case 'git_diff':
        return this.gitDiff(workspace, typeof args.path === 'string' ? args.path : undefined, Boolean(args.staged))
      case 'git_log':
        return this.gitLog(workspace, typeof args.limit === 'number' ? args.limit : undefined)
      case 'search_files':
        return this.searchFiles(workspace, typeof args.pattern === 'string' ? args.pattern : '', typeof args.path === 'string' ? args.path : undefined)
      case 'web_search':
        return this.webSearch(typeof args.query === 'string' ? args.query : '')
      case 'fetch_url':
        return this.fetchUrl(typeof args.url === 'string' ? args.url : '')
      default:
        return { ok: false, error: `unknown tool: ${call.function.name}` }
    }
  }
}

export function createOpenAiCompatibleProvider(providerId: string, defaultBaseURL: string): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider(providerId, defaultBaseURL)
}
