import Anthropic from '@anthropic-ai/sdk'
import { AgenticApiProvider, type AgenticRunContext, type AgenticRunResult } from './agenticApiProvider.js'

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

    const toolCalls: AgenticRunResult['toolCalls'] = []

    for (let turn = 1; turn <= MAX_AGENT_LOOP_TURNS; turn++) {
      const response = await client.messages.create(
        {
          model,
          system: ctx.req.resolvedAgent.systemPrompt || undefined,
          max_tokens: 4096,
          tools: [TEXT_EDITOR_TOOL, LIST_DIRECTORY_TOOL],
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

      messages.push({ role: 'assistant', content: response.content })
      const resultBlocks: Anthropic.Messages.ToolResultBlockParam[] = toolUseBlocks.map((block) => {
        const outcome = this.executeAnthropicTool(block, ctx.workspace)
        const entry = { name: block.name, argsSummary: summarize(block.input) }
        toolCalls.push(entry)
        ctx.handlers.onToolCall(entry)
        return {
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(outcome),
          is_error: outcome.ok === false,
        }
      })
      messages.push({ role: 'user', content: resultBlocks })
    }

    throw new Error(`exceeded ${MAX_AGENT_LOOP_TURNS} agent loop turns`)
  }

  /** Map one `tool_use` block (text_editor command or list_directory) to a base-class sandbox op. */
  private executeAnthropicTool(block: Anthropic.Messages.ToolUseBlock, workspace: string) {
    const input = (block.input ?? {}) as Record<string, unknown>
    if (block.name === 'list_directory') {
      return this.listWorkspaceDirectory(workspace, typeof input.path === 'string' ? input.path : undefined)
    }
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
