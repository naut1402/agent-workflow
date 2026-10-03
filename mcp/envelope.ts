// xem docs/mcp/server.md §5, §8.1
export type McpErrorCode = 'not_found' | 'invalid_input' | 'forbidden_in_mode' | 'internal'

export function ok(payload: unknown, opts?: { structured?: boolean }): any {
  const content = [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
  if (opts?.structured === false) return { content }
  return { content, structuredContent: payload }
}

export function fail(message: unknown): any
export function fail(code: McpErrorCode, message: unknown): any
export function fail(...args: [unknown] | [McpErrorCode, unknown]): any {
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
