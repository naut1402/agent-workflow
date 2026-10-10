// xem docs/mcp/server.md §5, §8.1
import type { ZodRawShape } from 'zod'
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'

export type ToolAccess = 'read' | 'write'

export type RootResolver = (project?: string) => { root: string } | { error: string }

export type McpErrorCode = 'not_found' | 'invalid_input' | 'forbidden_in_mode' | 'internal'

export interface ToolDef {
  name: string
  access: ToolAccess
  config: {
    title: string
    description: string
    inputSchema: ZodRawShape
    outputSchema?: ZodRawShape
    annotations: ToolAnnotations
  }
  handler: (args: any) => unknown
  hint?: string
  unavailableHint?: string
}

export const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, openWorldHint: false } as const

export abstract class AbstractMcpTools {
  constructor(private readonly resolveRoot: RootResolver) {}

  abstract definitions(): ToolDef[]

  protected ok(payload: unknown, opts?: { structured?: boolean }): any {
    const content = [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
    if (opts?.structured === false) return { content }
    return { content, structuredContent: payload }
  }

  protected fail(message: unknown): any
  protected fail(code: McpErrorCode, message: unknown): any
  protected fail(...args: [unknown] | [McpErrorCode, unknown]): any {
    if (args.length < 2) {
      return { isError: true, content: [{ type: 'text', text: String(args[0]) }] }
    }
    const [code, message] = args
    const text = String(message)
    return {
      isError: true,
      content: [{ type: 'text', text }],
      _meta: { error: { code, message: text } },
    }
  }

  protected requireRoot(project?: string): { root: string } | { error: any } {
    const resolved = this.resolveRoot(project)
    if ('error' in resolved) return { error: this.fail('not_found', resolved.error) }
    return resolved
  }
}
