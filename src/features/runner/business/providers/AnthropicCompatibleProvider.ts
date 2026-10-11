import Anthropic from '@anthropic-ai/sdk'
import { AbstractCompatibleApiProvider } from './AbstractCompatibleApiProvider.js'
import {
  AgenticRunError,
  EMPTY_REPLY_ERROR_MESSAGE,
  EMPTY_REPLY_NUDGE_TEXT,
  summarizeResult,
  type AgenticCompletionContext,
  type AgenticRunContext,
  type AgenticRunResult,
} from './AgenticApiProvider.js'
import * as workspaceTools from './agenticWorkspaceTools.js'
import type { TokenUsage } from './RunnerProvider.js'
import type { McpToolBridge } from '../mcpDelivery/ToolBridgeMcpDelivery.js'

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

function buildTools(extraTools: workspaceTools.ExtraTool[], webSearchConfigured: boolean): Anthropic.Messages.ToolUnion[] {
  const tools: Anthropic.Messages.ToolUnion[] = [TEXT_EDITOR_TOOL, LIST_DIRECTORY_TOOL]
  if (extraTools.includes('shell')) {
    tools.push({
      name: 'run_command',
      description: `Run a shell command in the workspace. Only these binaries are allowed: ${workspaceTools.SHELL_ALLOWLIST.join(', ')}.`,
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

async function createTurnMessage(
  client: Anthropic,
  params: Anthropic.Messages.MessageCreateParamsNonStreaming,
  opts: { signal?: AbortSignal; timeoutMs: number },
): Promise<Anthropic.Messages.Message> {
  try {
    return await client.messages.create(params, { signal: opts.signal })
  } catch (err: any) {
    throw new AgenticRunError(
      `gọi LLM thất bại (có thể do timeout sau ${opts.timeoutMs}ms hoặc response upstream không hợp lệ): ${String(err?.message ?? err)}`,
      params.messages,
    )
  }
}

function runUsageOf(response: Anthropic.Messages.Message): AgenticRunResult['usage'] {
  return {
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
    totalTokens: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
  }
}

function textOf(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}

// xem docs/architecture/code/runner.md §21
/** `anthropic-api` — drives the Messages API directly with a hand-rolled tool-use loop. */
export class AnthropicCompatibleProvider extends AbstractCompatibleApiProvider {

  async listModels(apiKey: string, baseURL: string): Promise<string[]> {
    const client = new Anthropic({ apiKey, baseURL: baseURL || this.defaultBaseURL })
    return this.sortedModelIds(await client.models.list())
  }

  /** Hook một lượt (`complete()`): một request messages, không tool. */
  protected override async completeOnce(ctx: AgenticCompletionContext): Promise<{ text: string; usage?: TokenUsage }> {
    const client = new Anthropic({
      apiKey: ctx.apiKey,
      baseURL: ctx.baseURL || this.defaultBaseURL,
      ...(ctx.timeoutMs ? { timeout: ctx.timeoutMs } : {}),
    })
    const response = await client.messages.create(
      {
        model: ctx.model,
        ...(ctx.system ? { system: ctx.system } : {}),
        max_tokens: ctx.maxTokens || 4096,
        messages: [{ role: 'user', content: ctx.prompt }],
      },
      { signal: ctx.signal },
    )
    const inputTokens = response.usage?.input_tokens ?? 0
    const outputTokens = response.usage?.output_tokens ?? 0
    return {
      text: textOf(response.content),
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    }
  }

  protected async runConversation(ctx: AgenticRunContext): Promise<AgenticRunResult> {
    const timeoutMs = this.requestTimeoutMs(ctx)
    const client = new Anthropic({ apiKey: ctx.apiKey, baseURL: ctx.runnerConfig.baseURL || this.defaultBaseURL, timeout: timeoutMs })
    const model = String(ctx.runnerConfig.model || '')

    const priorMessages = ctx.priorMessages as Anthropic.Messages.MessageParam[]
    const messages: Anthropic.Messages.MessageParam[] = priorMessages.length
      ? [...priorMessages]
      : [{ role: 'user', content: ctx.req.userPrompt }]

    const { baseTools, bridgeTools, system } = this.prepareToolset(ctx, buildTools, (t) => t.name)
    const tools: Anthropic.Messages.ToolUnion[] = [
      ...baseTools,
      ...bridgeTools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Messages.Tool.InputSchema,
      })),
    ]

    const toolCalls: AgenticRunResult['toolCalls'] = []
    let hasNudgedEmptyReply = false

    for (let turn = 1; turn <= MAX_AGENT_LOOP_TURNS; turn++) {
      const response = await createTurnMessage(
        client,
        {
          model,
          system,
          max_tokens: 4096,
          tools,
          messages,
        },
        { signal: ctx.signal, timeoutMs },
      )

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
      )

      const turnText = textOf(response.content)
      if (turnText) ctx.handlers.onAssistantChunk(turnText, { done: true })

      if (!toolUseBlocks.length) {
        if (turnText.trim()) {
          return {
            finalText: turnText,
            usage: runUsageOf(response),
            toolCalls,
            rawMessages: messages,
          }
        }

        // xem docs/architecture/code/runner.md §21
        if (!hasNudgedEmptyReply) {
          hasNudgedEmptyReply = true
          messages.push({ role: 'user', content: EMPTY_REPLY_NUDGE_TEXT })
          continue
        }
        throw new AgenticRunError(EMPTY_REPLY_ERROR_MESSAGE, messages)
      }

      messages.push({ role: 'assistant', content: response.content })
      const resultBlocks = await this.runToolUseBlocks(toolUseBlocks, ctx, toolCalls)
      messages.push({ role: 'user', content: resultBlocks })
    }

    throw new AgenticRunError(`exceeded ${MAX_AGENT_LOOP_TURNS} agent loop turns`, messages)
  }

  private async runToolUseBlocks(
    toolUseBlocks: Anthropic.Messages.ToolUseBlock[],
    ctx: AgenticRunContext,
    toolCalls: AgenticRunResult['toolCalls'],
  ): Promise<Anthropic.Messages.ToolResultBlockParam[]> {
    const resultBlocks: Anthropic.Messages.ToolResultBlockParam[] = []
    for (const block of toolUseBlocks) {
      const outcome = await this.executeAnthropicTool(block, ctx.workspace, ctx.mcpBridge)
      const entry = {
        name: block.name,
        argsSummary: summarize(block.input),
        ok: outcome.ok !== false,
        resultSummary: summarizeResult(outcome),
      }
      toolCalls.push(entry)
      ctx.handlers.onToolCall(entry)
      resultBlocks.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(outcome),
        is_error: outcome.ok === false,
      })
    }
    return resultBlocks
  }

  private async executeAnthropicTool(
    block: Anthropic.Messages.ToolUseBlock,
    workspace: string,
    bridge?: McpToolBridge | null,
  ) {
    const input = (block.input ?? {}) as Record<string, unknown>
    if (bridge?.has(block.name)) return bridge.call(block.name, input)
    switch (block.name) {
      case 'list_directory':
        return workspaceTools.listWorkspaceDirectory(workspace, typeof input.path === 'string' ? input.path : undefined)
      case 'run_command': {
        const command = typeof input.command === 'string' ? input.command : ''
        const args = Array.isArray(input.args) ? input.args.filter((a): a is string => typeof a === 'string') : []
        return workspaceTools.runShellCommand(workspace, command, args)
      }
      case 'git_status':
        return workspaceTools.gitStatus(workspace)
      case 'git_diff':
        return workspaceTools.gitDiff(workspace, typeof input.path === 'string' ? input.path : undefined, Boolean(input.staged))
      case 'git_log':
        return workspaceTools.gitLog(workspace, typeof input.limit === 'number' ? input.limit : undefined)
      case 'search_files':
        return workspaceTools.searchFiles(workspace, typeof input.pattern === 'string' ? input.pattern : '', typeof input.path === 'string' ? input.path : undefined)
      case 'web_search':
        return workspaceTools.webSearch(typeof input.query === 'string' ? input.query : '')
      case 'fetch_url':
        return workspaceTools.fetchUrl(typeof input.url === 'string' ? input.url : '')
      case 'str_replace_based_edit_tool': {
        const path = typeof input.path === 'string' ? input.path : ''
        switch (input.command) {
          case 'view':
            return workspaceTools.readWorkspaceFile(workspace, path)
          case 'create':
            return workspaceTools.writeWorkspaceFile(workspace, path, typeof input.file_text === 'string' ? input.file_text : '')
          case 'str_replace':
            return workspaceTools.editWorkspaceFile(
              workspace,
              path,
              typeof input.old_str === 'string' ? input.old_str : '',
              typeof input.new_str === 'string' ? input.new_str : '',
            )
          case 'insert':
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
    const current = workspaceTools.readWorkspaceFile(workspace, path)
    if ('error' in current) return current
    const lines = current.content.split('\n')
    const at = Math.max(0, Math.min(insertLine, lines.length))
    lines.splice(at, 0, text)
    return workspaceTools.writeWorkspaceFile(workspace, path, lines.join('\n'))
  }
}
