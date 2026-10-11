import type { McpConfigHandle } from '../mcpDelivery/FileMcpDelivery.js'
import {
  AbstractAgentCliProvider,
  type AgentCliInvocation,
  type AgentCliInvocationContext,
  type AgentCliOutput,
  type AgentCliProviderOptions,
} from './AbstractAgentCliProvider.js'
import type { ProviderCatalogInfo, TranscriptFormat } from './RunnerProvider.js'

function numToken(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
}

export interface CursorJsonOutput {
  session_id?: string
  result?: string
  /** Token usage from Cursor `--output-format json` result payload (camelCase). */
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  }
  model?: string
}


/** Extract Cursor/Claude-style usage object (camelCase or snake_case). */
export function parseCursorUsageObject(raw: unknown): CursorJsonOutput['usage'] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const u = raw as Record<string, unknown>
  const usage = {
    inputTokens: numToken(u.inputTokens ?? u.input_tokens),
    outputTokens: numToken(u.outputTokens ?? u.output_tokens),
    cacheReadTokens: numToken(u.cacheReadTokens ?? u.cache_read_input_tokens ?? u.cache_read_tokens),
    cacheWriteTokens: numToken(
      u.cacheWriteTokens ?? u.cache_creation_input_tokens ?? u.cache_write_tokens,
    ),
  }
  if (
    usage.inputTokens === 0 &&
    usage.outputTokens === 0 &&
    usage.cacheReadTokens === 0 &&
    usage.cacheWriteTokens === 0
  ) {
    return undefined
  }
  return usage
}

function cursorFieldsFrom(parsed: Record<string, unknown>): CursorJsonOutput {
  const out: CursorJsonOutput = {
    session_id: typeof parsed.session_id === 'string' ? parsed.session_id : undefined,
    result: typeof parsed.result === 'string' ? parsed.result : undefined,
  }
  const usage = parseCursorUsageObject(parsed.usage)
  if (usage) out.usage = usage
  if (typeof parsed.model === 'string' && parsed.model.trim()) out.model = parsed.model.trim()
  return out
}

/** Parse cursor-agent JSON stdout; tolerates leading/trailing whitespace/noise. */
export function parseCursorJsonOutput(stdout: string): CursorJsonOutput {
  const trimmed = stdout.trim()
  if (!trimmed) return {}
  try {
    return cursorFieldsFrom(JSON.parse(trimmed) as Record<string, unknown>)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start < 0 || end <= start) return {}
    try {
      return cursorFieldsFrom(JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>)
    } catch {
      return {}
    }
  }
}

export interface CursorJsonInvocationInput {
  flags: string[]
  prompt: string
  resumeSessionId?: string
  /** Job có MCP server nào không — `false` (mặc định) thì argv giữ nguyên. */
  mcpEnabled?: boolean
}

export interface CursorJsonInvocation {
  args: string[]
  stdinInput: string
}

// xem docs/architecture/code/runner.md §18
/** Build cursor headless invocation — JSON output, prompt on stdin. */
export function buildCursorJsonInvocation(input: CursorJsonInvocationInput): CursorJsonInvocation {
  const base = Array.isArray(input.flags) ? [...input.flags] : []
  if (!base.includes('-p')) base.push('-p')
  if (!base.some((f) => f === '--output-format' || f.startsWith('--output-format='))) {
    base.push('--output-format', 'json')
  }
  const hasSandbox = base.some(
    (f) => f === '--sandbox' || f.startsWith('--sandbox='),
  )
  if (!hasSandbox) base.push('--sandbox', 'disabled')
  const hasForce =
    base.includes('--yolo') || base.includes('-f') || base.includes('--force')
  if (!hasForce) base.push('--force')
  if (!base.includes('--trust')) base.push('--trust')
  // xem docs/architecture/code/runner.md §18
  if (input.mcpEnabled && !base.includes('--approve-mcps')) base.push('--approve-mcps')
  if (input.resumeSessionId) base.push('--resume', input.resumeSessionId)
  return { args: base, stdinInput: input.prompt }
}

/** Flag-only argv for cursor JSON mode (prompt goes on stdin). */
export function buildCursorJsonArgs(
  flags: string[],
  prompt: string,
  resumeSessionId?: string,
): string[] {
  return buildCursorJsonInvocation({ flags, prompt, resumeSessionId }).args
}

/**
 * Cursor Agent CLI (`agent` / `cursor-agent`) — prompt qua stdin, output JSON
 * mang session id + usage, MCP qua `<workspace>/.cursor/mcp.json`.
 */
export class CursorCliProvider extends AbstractAgentCliProvider {
  readonly providerId = 'cursor-cli'
  readonly catalog: ProviderCatalogInfo = {
    kind: 'local-console',
    label: 'Cursor CLI',
    modelListing: 'none',
    localCommand: { id: 'cursor', command: 'agent', match: { base: '^(agent|cursor-agent)$', path: 'cursor-agent' } },
  }
  override readonly transcriptFormat: TranscriptFormat = 'cursor-projects'

  constructor(opts: AgentCliProviderOptions = {}) {
    super({ defaultCliPath: 'agent', sessionCapture: 'parse-json' }, opts)
  }

  protected buildInvocation(ctx: AgentCliInvocationContext): AgentCliInvocation {
    return buildCursorJsonInvocation({
      flags: ctx.flags,
      prompt: ctx.prompt,
      resumeSessionId: ctx.sessionPlan.resumeSessionId,
      mcpEnabled: Boolean(ctx.mcpHandle),
    })
  }

  protected override parseOutput(stdout: string): AgentCliOutput {
    const parsed = parseCursorJsonOutput(stdout)
    const out: AgentCliOutput = { stdout: parsed.result != null ? parsed.result : stdout }
    if (parsed.session_id) out.sessionId = parsed.session_id
    if (parsed.usage) {
      const total =
        parsed.usage.inputTokens +
        parsed.usage.outputTokens +
        parsed.usage.cacheReadTokens +
        parsed.usage.cacheWriteTokens
      out.tokenUsage = {
        inputTokens: parsed.usage.inputTokens,
        outputTokens: parsed.usage.outputTokens,
        cacheReadTokens: parsed.usage.cacheReadTokens,
        cacheWriteTokens: parsed.usage.cacheWriteTokens,
        totalTokens: total,
        model: parsed.model,
      }
    }
    return out
  }

  protected override mcpNotice(handle: McpConfigHandle): string | null {
    if (handle.kind !== 'workspace-config-file') return null
    return (
      '[runner] MCP: cursor nhận cấu hình qua <workspace>/.cursor/mcp.json và chạy với '
      + '--approve-mcps ⇒ các server trên được GHI vào danh sách phê duyệt cục bộ '
      + '(~/.cursor), tác dụng phụ này TỒN TẠI SAU khi job kết thúc\n'
    )
  }
}
