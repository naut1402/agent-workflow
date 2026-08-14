import { Agent, OpenAIChatCompletionsModel, run, tool } from '@openai/agents'
import OpenAI from 'openai'
import { z } from 'zod'
import { AgenticApiProvider, type AgenticRunContext, type AgenticRunResult } from './agenticApiProvider.js'

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

/**
 * `openai-api` / `gemini-api` / `xai-api` — all expose an OpenAI-compatible
 * Chat Completions endpoint, so one wrapper (differing only in `defaultBaseURL`)
 * covers the group via the official OpenAI Agents SDK.
 *
 * A fresh `OpenAIChatCompletionsModel` bound to a per-call client (rather than
 * the SDK's process-wide `setDefaultOpenAIClient`) keeps concurrent jobs for
 * different providers/connections from racing on shared global state.
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
    const client = new OpenAI({ baseURL: ctx.runnerConfig.baseURL || this.defaultBaseURL, apiKey: ctx.apiKey })
    const model = new OpenAIChatCompletionsModel(client, String(ctx.runnerConfig.model || ''))

    const tools = [
      tool({
        name: 'read_file',
        description: 'Read a text file under the workspace.',
        parameters: z.object({ path: z.string() }),
        execute: (a) => JSON.stringify(this.readWorkspaceFile(ctx.workspace, a.path)),
      }),
      tool({
        name: 'write_file',
        description: 'Write (create or overwrite) a text file under the workspace.',
        parameters: z.object({ path: z.string(), content: z.string() }),
        execute: (a) => JSON.stringify(this.writeWorkspaceFile(ctx.workspace, a.path, a.content)),
      }),
      tool({
        name: 'edit_file',
        description: 'Replace one unique occurrence of old_string with new_string in a workspace file.',
        parameters: z.object({ path: z.string(), old_string: z.string(), new_string: z.string() }),
        execute: (a) => JSON.stringify(this.editWorkspaceFile(ctx.workspace, a.path, a.old_string, a.new_string)),
      }),
      tool({
        name: 'list_directory',
        description: 'List entries of a directory under the workspace.',
        parameters: z.object({ path: z.string().optional() }),
        execute: (a) => JSON.stringify(this.listWorkspaceDirectory(ctx.workspace, a.path)),
      }),
    ]

    const agent = new Agent({
      name: ctx.req.resolvedAgent.name || 'agent',
      instructions: ctx.req.resolvedAgent.systemPrompt || '',
      model,
      tools,
    })

    const priorMessages = ctx.priorMessages as any[]
    const input = priorMessages.length ? [...priorMessages, { role: 'user', content: ctx.req.userPrompt }] : ctx.req.userPrompt
    const result = await run(agent, input as any, { signal: ctx.signal })

    const toolCalls = result.newItems
      .filter((item: any) => item.type === 'tool_call_item' && item.rawItem?.type === 'function_call')
      .map((item: any) => ({
        name: String(item.rawItem.name || 'tool'),
        argsSummary: summarizeArgs(item.rawItem.arguments),
      }))

    const usage = result.state.usage
    return {
      finalText: typeof result.finalOutput === 'string' ? result.finalOutput : String(result.finalOutput ?? ''),
      usage: {
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        totalTokens: usage?.totalTokens,
      },
      toolCalls,
      rawMessages: result.history,
    }
  }
}

export function createOpenAiCompatibleProvider(providerId: string, defaultBaseURL: string): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider(providerId, defaultBaseURL)
}
