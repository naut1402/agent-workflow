// xem docs/mcp/server.md §5, §8.1
import { z, type ZodRawShape } from 'zod'
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { resolveProjectRoot } from '../src/backend/registry.js'

export type ToolAccess = 'read' | 'write'

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

export const ProjectRef = z
  .string()
  .min(1)
  .describe('Project id (from list_projects); omit for the default project.')

export const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, openWorldHint: false } as const

export abstract class AbstractMcpTools {
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
    const root = resolveProjectRoot(project ?? null)
    if (root) return { root }
    return {
      error: this.fail(
        'not_found',
        project
          ? `unknown project: ${project}`
          : 'no default project — call list_projects, or set DEV_TEAM_ROOT / DEV_TEAM_DASHBOARD_HOME for this process',
      ),
    }
  }
}
