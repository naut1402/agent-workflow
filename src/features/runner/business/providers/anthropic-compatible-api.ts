import Anthropic from '@anthropic-ai/sdk'
import {
  AgenticApiProvider,
  EMPTY_REPLY_ERROR_MESSAGE,
  EMPTY_REPLY_NUDGE_TEXT,
  SHELL_ALLOWLIST,
  type AgenticRunContext,
  type AgenticRunResult,
  type ExtraTool,
} from './agenticApiProvider.js'

/** Chặn vòng lặp vô hạn khi model liên tục gọi tool. */
const MAX_AGENT_LOOP_TURNS = 8

const TEXT_EDITOR_TOOL: Anthropic.Messages.ToolTextEditor20250728 = {
  type: 'text_editor_20250728',
  name: 'str_replace_based_edit_tool',
}

const LIST_DIRECTORY_TOOL: Anthropic.Messages.Tool = {
  name: 'list_directory',
  description: 'List entries of a directory under the workspace.',
  input_schema: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Directory path relative to the workspace, defaults to "."' } },
  },
}

/**
 * Base 2 tools (text editor + list_directory) always registered; `extraTools`
 * (from `Connection.config.extraTools`, default `[]`) opts a Connection into
 * shell/git/search/web on top — see agenticApiProvider.ts. `webSearchConfigured`
 * additionally gates `web_search` alone so an unconfigured `BRAVE_SEARCH_API_KEY`
 * hides the tool instead of registering one that always errors.
 */
function buildTools(extraTools: ExtraTool[], webSearchConfigured: boolean): Anthropic.Messages.ToolUnion[] {
  const tools: Anthropic.Messages.ToolUnion[] = [TEXT_EDITOR_TOOL, LIST_DIRECTORY_TOOL]
  if (extraTools.includes('shell')) {
    tools.push({
      name: 'run_command',
      description: `Run a shell command in the workspace. Only these binaries are allowed: ${SHELL_ALLOWLIST.join(', ')}.`,
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Binary to run — must be in the allowlist.' },
          args: { type: 'array', items: { type: 'string' }, description: 'Argument list, passed verbatim (no shell interpretation).' },
        },
        required: ['command'],
      },
    })
  }
  if (extraTools.includes('git')) {
    tools.push(
      {
        name: 'git_status',
        description: 'Show git status (porcelain) of the workspace.',
        input_schema: { type: 'object', properties: {} },
      },
      {
        name: 'git_diff',
        description: 'Show git diff of the workspace or a single file.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to the workspace (optional).' },
            staged: { type: 'boolean', description: 'Diff staged changes instead of the working tree.' },
          },
        },
      },
      {
        name: 'git_log',
        description: 'Show recent commit log (oneline, capped at 50).',
        input_schema: { type: 'object', properties: { limit: { type: 'number', description: 'Max commits to show (1-50, default 20).' } } },
      },
    )
  }
  if (extraTools.includes('search')) {
    tools.push({
      name: 'search_files',
      description: 'Search for a literal substring (not a regex) across text files in the workspace.',
      input_schema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Literal substring to search for.' },
          path: { type: 'string', description: 'Directory to search under, relative to the workspace (optional).' },
        },
        required: ['pattern'],
      },
    })
  }
  if (extraTools.includes('web')) {
    if (webSearchConfigured) {
      tools.push({
        name: 'web_search',
        description: 'Search the web (Brave Search), returns up to 5 results.',
        input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      })
    }
    tools.push({
      name: 'fetch_url',
      description: 'Fetch the text content of a public https URL (private/loopback hosts are blocked).',
      input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    })
  }
  return tools
}

function summarize(input: unknown): string {
  try {
    const json = JSON.stringify(input)
    if (!json) return ''
    return json.length > 200 ? `${json.slice(0, 200)}…` : json
  } catch {
    return ''
  }
}

function textOf(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}

/**
 * `anthropic-api` — no official API-thuần Agent SDK exists for Anthropic (the
 * Claude Agent SDK spawns the `claude` CLI subprocess, which duplicates
 * `claude-code-cli`, see design.md §2), so this wrapper drives the Messages
 * API directly with a small hand-rolled tool-use loop, mapping each
 * `text_editor`/`list_directory` tool_use block onto the 4 sandboxed file-ops
 * shared with `OpenAiCompatibleProvider` via the `AgenticApiProvider` base.
 */
export class AnthropicCompatibleProvider extends AgenticApiProvider {
  readonly providerId: string
  private readonly defaultBaseURL: string

  constructor(providerId: string, defaultBaseURL: string) {
    super()
    this.providerId = providerId
    this.defaultBaseURL = defaultBaseURL
  }

  async listModels(apiKey: string, baseURL: string): Promise<string[]> {
    const client = new Anthropic({ apiKey, baseURL: baseURL || this.defaultBaseURL })
    const page = await client.models.list()
    const ids: string[] = []
    for await (const m of page) ids.push(m.id)
    return ids.sort()
  }

  protected async runConversation(ctx: AgenticRunContext): Promise<AgenticRunResult> {
    const client = new Anthropic({ apiKey: ctx.apiKey, baseURL: ctx.runnerConfig.baseURL || this.defaultBaseURL })
    const model = String(ctx.runnerConfig.model || '')

    const priorMessages = ctx.priorMessages as Anthropic.Messages.MessageParam[]
    const messages: Anthropic.Messages.MessageParam[] = priorMessages.length
      ? [...priorMessages]
      : [{ role: 'user', content: ctx.req.userPrompt }]

    const extraTools = this.resolveExtraTools(ctx.runnerConfig)
    const tools = buildTools(extraTools, this.isWebSearchConfigured())
    const system = [this.buildToolUsagePreamble(tools.map((t) => t.name)), ctx.req.resolvedAgent.systemPrompt || ''].join('\n\n')

    const toolCalls: AgenticRunResult['toolCalls'] = []
    let hasNudgedEmptyReply = false

    for (let turn = 1; turn <= MAX_AGENT_LOOP_TURNS; turn++) {
      const response = await client.messages.create(
        {
          model,
          system,
          max_tokens: 4096,
          tools,
          messages,
        },
        { signal: ctx.signal },
      )

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
      )

      // Surface this turn's text as soon as it arrives — whether or not tool
      // calls follow — instead of only the final no-tool-use turn (level-1
      // streaming; see AgenticStreamHandlers). Not a real per-token delta
      // (this SDK call isn't streamed), so one call covers the whole turn.
      const turnText = textOf(response.content)
      if (turnText) ctx.handlers.onAssistantChunk(turnText, { done: true })

      if (!toolUseBlocks.length) {
        if (turnText.trim()) {
          return {
            finalText: turnText,
            usage: {
              inputTokens: response.usage?.input_tokens,
              outputTokens: response.usage?.output_tokens,
              totalTokens: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
            },
            toolCalls,
            rawMessages: messages,
          }
        }

        // Empty content + no tool use — the model may not understand this
        // provider's toolset. Give it exactly one nudge before treating this
        // as a real failure instead of silently reporting job success (see
        // agenticApiProvider.ts's EMPTY_REPLY_NUDGE_TEXT for rationale).
        // Deliberately does NOT push an empty assistant message — Anthropic's
        // API rejects any non-final message with empty content ("all messages
        // must have non-empty content except for the optional final assistant
        // message"), which would break this request before the model ever
        // sees the nudge.
        if (!hasNudgedEmptyReply) {
          hasNudgedEmptyReply = true
          messages.push({ role: 'user', content: EMPTY_REPLY_NUDGE_TEXT })
          continue
        }
        throw new Error(EMPTY_REPLY_ERROR_MESSAGE)
      }

      messages.push({ role: 'assistant', content: response.content })
      const resultBlocks: Anthropic.Messages.ToolResultBlockParam[] = []
      for (const block of toolUseBlocks) {
        const outcome = await this.executeAnthropicTool(block, ctx.workspace)
        const entry = { name: block.name, argsSummary: summarize(block.input) }
        toolCalls.push(entry)
        ctx.handlers.onToolCall(entry)
        resultBlocks.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(outcome),
          is_error: outcome.ok === false,
        })
      }
      messages.push({ role: 'user', content: resultBlocks })
    }

    throw new Error(`exceeded ${MAX_AGENT_LOOP_TURNS} agent loop turns`)
  }

  /** Map one `tool_use` block to a base-class sandbox op (text_editor command, list_directory, or an opt-in extra tool). */
  private async executeAnthropicTool(block: Anthropic.Messages.ToolUseBlock, workspace: string) {
    const input = (block.input ?? {}) as Record<string, unknown>
    switch (block.name) {
      case 'list_directory':
        return this.listWorkspaceDirectory(workspace, typeof input.path === 'string' ? input.path : undefined)
      case 'run_command': {
        const command = typeof input.command === 'string' ? input.command : ''
        const args = Array.isArray(input.args) ? input.args.filter((a): a is string => typeof a === 'string') : []
        return this.runShellCommand(workspace, command, args)
      }
      case 'git_status':
        return this.gitStatus(workspace)
      case 'git_diff':
        return this.gitDiff(workspace, typeof input.path === 'string' ? input.path : undefined, Boolean(input.staged))
      case 'git_log':
        return this.gitLog(workspace, typeof input.limit === 'number' ? input.limit : undefined)
      case 'search_files':
        return this.searchFiles(workspace, typeof input.pattern === 'string' ? input.pattern : '', typeof input.path === 'string' ? input.path : undefined)
      case 'web_search':
        return this.webSearch(typeof input.query === 'string' ? input.query : '')
      case 'fetch_url':
        return this.fetchUrl(typeof input.url === 'string' ? input.url : '')
      case 'str_replace_based_edit_tool': {
        const path = typeof input.path === 'string' ? input.path : ''
        switch (input.command) {
          case 'view':
            return this.readWorkspaceFile(workspace, path)
          case 'create':
            return this.writeWorkspaceFile(workspace, path, typeof input.file_text === 'string' ? input.file_text : '')
          case 'str_replace':
            return this.editWorkspaceFile(
              workspace,
              path,
              typeof input.old_str === 'string' ? input.old_str : '',
              typeof input.new_str === 'string' ? input.new_str : '',
            )
          case 'insert':
            // `insert_line`/`insert_text` place text after a given line; the shared
            // sandbox only exposes whole-file read/write/edit, so insert is
            // implemented here in terms of those primitives rather than adding a
            // 5th shared op for a single caller.
            return this.insertIntoFile(
              workspace,
              path,
              Number(input.insert_line ?? 0),
              typeof input.new_str === 'string' ? input.new_str : '',
            )
          default:
            return { ok: false, error: `unknown text_editor command: ${String(input.command)}` }
        }
      }
      default:
        return { ok: false, error: `unknown tool: ${block.name}` }
    }
  }

  private insertIntoFile(workspace: string, path: string, insertLine: number, text: string) {
    const current = this.readWorkspaceFile(workspace, path)
    // Narrow via `'error' in v` rather than `!v.ok` — see coding-convention.md §2
    // (boolean-discriminant narrowing is fragile under this repo's vue-tsc).
    if ('error' in current) return current
    const lines = current.content.split('\n')
    const at = Math.max(0, Math.min(insertLine, lines.length))
    lines.splice(at, 0, text)
    return this.writeWorkspaceFile(workspace, path, lines.join('\n'))
  }
}

export function createAnthropicCompatibleProvider(providerId: string, defaultBaseURL: string): AnthropicCompatibleProvider {
  return new AnthropicCompatibleProvider(providerId, defaultBaseURL)
}
