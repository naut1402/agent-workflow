import OpenAI from 'openai'
import { AgenticApiProvider, type AgenticRunContext, type AgenticRunResult } from './agenticApiProvider.js'

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

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
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

  protected async runConversation(ctx: AgenticRunContext): Promise<AgenticRunResult> {
    const model = String(ctx.runnerConfig.model || '')
    if (!model) throw new Error('model is required — set it on the runner connection (ConnectionDialog)')

    const client = new OpenAI({ baseURL: ctx.runnerConfig.baseURL || this.defaultBaseURL, apiKey: ctx.apiKey })

    // `messages` excludes the system prompt — it is re-prepended on every turn
    // so the persisted rawMessages stay resume-ready without duplicating it.
    const priorMessages = (ctx.priorMessages ?? []) as OpenAI.Chat.Completions.ChatCompletionMessageParam[]
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = priorMessages.length
      ? [...priorMessages, { role: 'user', content: ctx.req.userPrompt }]
      : [{ role: 'user', content: ctx.req.userPrompt }]

    const toolCalls: AgenticRunResult['toolCalls'] = []
    const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }

    for (let turn = 1; turn <= MAX_AGENT_LOOP_TURNS; turn++) {
      const response = await client.chat.completions.create(
        {
          model,
          messages: [
            { role: 'system', content: ctx.req.resolvedAgent.systemPrompt || '' },
            ...messages,
          ],
          tools: TOOLS,
        },
        { signal: ctx.signal },
      )

      usage.inputTokens += response.usage?.prompt_tokens ?? 0
      usage.outputTokens += response.usage?.completion_tokens ?? 0
      usage.totalTokens += response.usage?.total_tokens ?? 0

      const message = response.choices[0]?.message
      // Only function tool calls exist in this provider's toolset; filter keeps
      // the union narrowed to the spec shape we echo back below.
      const calls = (message?.tool_calls ?? []).filter(
        (call): call is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
          call.type === 'function',
      )
      if (!calls.length) {
        const finalText = typeof message?.content === 'string' ? message.content : ''
        // Include the final reply in the persisted history so a resumed session
        // sees the model's own last answer.
        messages.push({ role: 'assistant', content: finalText })
        return { finalText, usage, toolCalls, rawMessages: messages }
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
        const outcome = this.executeTool(call, ctx.workspace)
        toolCalls.push({ name: call.function.name, argsSummary: summarizeArgs(call.function.arguments) })
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(outcome) })
      }
    }
    throw new Error(`exceeded ${MAX_AGENT_LOOP_TURNS} agent loop turns`)
  }

  /** Map one chat-completions function tool call onto a base-class sandbox op. */
  private executeTool(call: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall, workspace: string) {
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
      default:
        return { ok: false, error: `unknown tool: ${call.function.name}` }
    }
  }
}

export function createOpenAiCompatibleProvider(providerId: string, defaultBaseURL: string): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider(providerId, defaultBaseURL)
}
