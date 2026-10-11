import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { MCP_MAX_TIMEOUT_MS, MCP_MIN_TIMEOUT_MS, type McpStdioServer } from '../schemas/mcpServer.js'
import {
  McpServer,
  type McpCliContext,
  type McpCliEntry,
  type McpResolveContext,
  type McpServerBaseFields,
  type McpTransportOptions,
  type McpTransportPlan,
  type ResolvedMcpServer,
} from './McpServer.js'
import { SecretMasker } from './SecretMasker.js'

const STARTUP_TIMEOUT_MIN_SEC = MCP_MIN_TIMEOUT_MS / 1000
const STARTUP_TIMEOUT_MAX_SEC = MCP_MAX_TIMEOUT_MS / 1000

/** MCP server chạy như tiến trình con, nói chuyện qua stdin/stdout. */
export class StdioMcpServer extends McpServer<McpStdioServer> {
  constructor(config: McpStdioServer) {
    super(config)
  }

  // xem docs/architecture/code/mcp.md §7
  /** Bản ghi đã chuẩn hoá — `null` khi `command` rỗng. */
  static normalise(raw: any, base: McpServerBaseFields): StdioMcpServer | null {
    const command = String(raw.command || '').trim()
    if (!command) return null
    return new StdioMcpServer({
      ...base,
      transport: 'stdio',
      command,
      args: Array.isArray(raw.args) ? raw.args.filter((a: unknown): a is string => typeof a === 'string') : [],
      env: McpServer.toStringRecord(raw.env),
      ...(typeof raw.cwd === 'string' && raw.cwd.trim() ? { cwd: raw.cwd.trim() } : {}),
    })
  }

  protected rebuild(config: McpStdioServer): StdioMcpServer {
    return new StdioMcpServer(config)
  }

  masked(): McpStdioServer {
    const server = this.config
    return {
      ...server,
      env: SecretMasker.maskRecord(server.env),
      ...(server.args === undefined ? {} : { args: SecretMasker.maskArgs(server.args) }),
    }
  }

  restoreMasked(previous: McpServer | null, warnings?: string[]): StdioMcpServer {
    const next = this.config
    const prevStdio = previous && previous.config.transport === 'stdio' ? previous.config : null
    return new StdioMcpServer({
      ...next,
      env: McpServer.restoreMaskedRecord(next.env, prevStdio?.env ?? {}),
      ...(next.args === undefined
        ? {}
        : { args: restoreMaskedArgs(next.args, prevStdio?.args, warnings) }),
    })
  }

  secretValues(): string[] {
    const server = this.config
    const values = Object.values(server.env || {}).filter(SecretMasker.isMaskable)
    return [
      ...values,
      ...SecretMasker.secretArgs(server.args)
        .map((hit) => hit.value)
        .filter(SecretMasker.isMaskable),
    ]
  }

  destination(): string {
    return `stdio ${this.config.command} ${JSON.stringify(this.config.args ?? [])}`
  }

  needsStoredSecret(): boolean {
    const server = this.config
    if (Object.values(server.env || {}).some((v) => v === SecretMasker.MASK)) return true
    return (server.args ?? []).some((a) => a === SecretMasker.MASK || a.endsWith(`=${SecretMasker.MASK}`))
  }

  /** Mã cảnh báo cấu hình — không chặn lưu. */
  warnings(): string[] {
    return SecretMasker.secretArgs(this.config.args).length ? [SecretMasker.WARN_ARGS_SECRET_LITERAL] : []
  }

  resolve(_ctx?: McpResolveContext): ResolvedMcpServer {
    const { values, warnings } = McpServer.resolveEnvRefs(this.config.env)
    return { values, secret: null, warnings }
  }

  /** Entry stdio cho file cấu hình CLI — `startupTimeoutSec` chỉ khai khi server có `timeoutMs`. */
  toCliEntry(ctx: McpCliContext): McpCliEntry {
    const server = this.config
    const secrets = this.secretValues()
    const warnings: string[] = []

    const resolved = this.resolve(ctx)
    warnings.push(...McpServer.prefix(server.id, resolved.warnings))
    secrets.push(...Object.values(resolved.values).filter(SecretMasker.isMaskable))
    if (server.cwd && server.cwd !== ctx.workspace) {
      warnings.push(
        `${server.id}: cấu hình MCP của CLI không có khoá cwd — server sẽ chạy tại ${ctx.workspace}`,
      )
    }
    const startupTimeoutSec = toStartupTimeoutSec(server.timeoutMs)
    if (startupTimeoutSec !== null) {
      warnings.push(...McpServer.prefix(server.id, timeoutWarnings(server.timeoutMs!, startupTimeoutSec)))
    }
    return {
      entry: {
        type: 'stdio',
        command: server.command,
        args: server.args ?? [],
        env: resolved.values,
        ...(startupTimeoutSec === null ? {} : { startupTimeoutSec }),
      },
      secrets,
      warnings,
    }
  }

  createTransport(opts: McpTransportOptions = {}): McpTransportPlan {
    const server = this.config
    const resolved = this.resolve(opts)
    const hostEnv = fullProcessEnv()
    return {
      transport: new StdioClientTransport({
        command: server.command,
        args: server.args ?? [],
        env: { ...hostEnv, ...resolved.values },
        cwd: server.cwd || opts.cwd || process.cwd(),
        stderr: 'pipe',
      }),
      secrets: [
        // xem docs/architecture/code/mcp.md §7
        ...Object.values(resolved.values).filter(SecretMasker.isMaskable),
        ...Object.entries(hostEnv)
          .filter(([key, value]) => SecretMasker.looksLikeSecretLiteral(key, value))
          .map(([, value]) => value),
      ],
      warnings: resolved.warnings,
    }
  }
}

// xem docs/architecture/code/mcp.md §7
function restoreMaskedArgs(
  next?: string[],
  previous?: string[],
  warnings?: string[],
): string[] {
  const out: string[] = []
  const list = next ?? []
  const previousHits = new Set(SecretMasker.secretArgs(previous).map((hit) => hit.index))
  const maskedPrevious = SecretMasker.maskArgs(previous)
  for (let i = 0; i < list.length; i++) {
    const arg = list[i]
    const inline = /^(--?[^=]+)=\*\*\*$/.exec(arg)

    if (arg === SecretMasker.MASK) {
      const anchorOk = i === 0 || maskedPrevious[i - 1] === list[i - 1]
      if (anchorOk && previousHits.has(i) && previous?.[i] !== undefined) out.push(previous[i])
      else warnings?.push(SecretMasker.WARN_ARGS_SECRET_DROPPED)
      continue
    }
    if (inline) {
      const prevArg = previous?.[i]
      if (prevArg?.startsWith(`${inline[1]}=`)) out.push(prevArg)
      else warnings?.push(SecretMasker.WARN_ARGS_SECRET_DROPPED)
      continue
    }
    out.push(arg)
  }
  return out
}

// xem docs/architecture/code/mcp.md §7
function fullProcessEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}

// xem docs/mcp/client.md §7
function toStartupTimeoutSec(timeoutMs: number | undefined): number | null {
  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return null
  const sec = Math.round(timeoutMs / 1000)
  return Math.min(STARTUP_TIMEOUT_MAX_SEC, Math.max(STARTUP_TIMEOUT_MIN_SEC, sec))
}

function timeoutWarnings(timeoutMs: number, startupTimeoutSec: number): string[] {
  if (timeoutMs < MCP_MIN_TIMEOUT_MS || timeoutMs > MCP_MAX_TIMEOUT_MS) {
    return [
      `timeout ${timeoutMs}ms nằm ngoài miền [${STARTUP_TIMEOUT_MIN_SEC}s, ${STARTUP_TIMEOUT_MAX_SEC}s] của CLI — job dùng ${startupTimeoutSec}s`,
    ]
  }
  if (timeoutMs !== startupTimeoutSec * 1000) {
    return [
      `timeout ${timeoutMs}ms được làm tròn thành ${startupTimeoutSec}s — CLI chỉ nhận số nguyên giây`,
    ]
  }
  return []
}
