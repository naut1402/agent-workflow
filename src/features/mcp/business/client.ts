import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FetchLike, Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { assertMcpEndpoint } from './endpointGuard.js'
import { resolveEnvRefs, resolveHeaders } from './resolveRefs.js'
import {
  MCP_MAX_TOOL_DESCRIPTION_LENGTH,
  MCP_MAX_TOOL_NAMES,
  isStdioServer,
  maskSecretText,
  resolveTimeoutMs,
  type McpServerConfig,
} from './types.js'

const CLIENT_INFO = { name: 'dev-team-dashboard', version: '1.0.0' }
const MAX_ERROR_LENGTH = 500

export interface McpProbeTool {
  name: string
  description: string
}

export interface McpProbeResult {
  ok: boolean
  serverInfo?: { name: string; version: string }
  tools: McpProbeTool[]
  error?: string
  warnings: string[]
  durationMs: number
}

export interface McpProbeOptions {
  listTools?: boolean
  timeoutMs?: number
  /** cwd mặc định cho server stdio khi bản thân server không khai. */
  cwd?: string
  /** Secret đã giải từ credential profile — caller (controller/runner) tiêm vào. */
  secret?: string | null
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`mcp: ${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, guard]).finally(() => {
    if (timer) clearTimeout(timer)
  }) as Promise<T>
}

function fetchWithHeaders(headers: Record<string, string>): FetchLike {
  return (url, init) =>
    fetch(url, {
      ...init,
      headers: { ...Object.fromEntries(new Headers(init?.headers).entries()), ...headers },
    })
}

interface TransportPlan {
  transport: Transport
  secrets: string[]
  warnings: string[]
}

function buildTransport(server: McpServerConfig, opts: McpProbeOptions): TransportPlan {
  if (isStdioServer(server)) {
    const resolved = resolveEnvRefs(server.env)
    return {
      transport: new StdioClientTransport({
        command: server.command,
        args: server.args ?? [],
        env: { ...getDefaultEnvironment(), ...resolved.env },
        cwd: server.cwd || opts.cwd || process.cwd(),
        stderr: 'pipe',
      }),
      secrets: Object.values(resolved.env),
      warnings: resolved.warnings,
    }
  }

  const url = assertMcpEndpoint(server.url)
  const resolved = resolveHeaders(server, opts.secret)
  const headers = resolved.env
  // `requestInit` chỉ áp cho POST; stream GET của SSE lấy fetch ở tuỳ chọn gốc,
  // nên header phải đi qua `fetch` chứ không chỉ `requestInit`.
  const common = { requestInit: { headers }, fetch: fetchWithHeaders(headers) }
  return {
    transport:
      server.transport === 'sse'
        ? new SSEClientTransport(url, common)
        : new StreamableHTTPClientTransport(url, common),
    secrets: Object.values(headers),
    warnings: resolved.warnings,
  }
}

/**
 * Kết nối thật tới MCP server để kiểm tra cấu hình. Không bao giờ ném: lỗi trả
 * về trong `error` đã mask secret. `client.close()` trong `finally` là thứ giết
 * tiến trình con của transport stdio.
 */
export async function probeMcpServer(
  server: McpServerConfig,
  opts: McpProbeOptions = {},
): Promise<McpProbeResult> {
  const started = Date.now()
  const timeoutMs = resolveTimeoutMs(opts.timeoutMs, server.timeoutMs)
  let secrets: string[] = []
  let client: Client | null = null
  const warnings: string[] = []

  try {
    const plan = buildTransport(server, opts)
    secrets = plan.secrets
    warnings.push(...plan.warnings)

    client = new Client(CLIENT_INFO, { capabilities: {} })
    await withTimeout(client.connect(plan.transport), timeoutMs, 'connect')
    const info = client.getServerVersion()

    let tools: McpProbeTool[] = []
    if (opts.listTools) {
      const listed = await withTimeout(client.listTools(), timeoutMs, 'tools/list')
      tools = (listed.tools ?? []).slice(0, MCP_MAX_TOOL_NAMES).map((tool) => ({
        name: String(tool.name ?? ''),
        description: String(tool.description ?? '').slice(0, MCP_MAX_TOOL_DESCRIPTION_LENGTH),
      }))
    }

    return {
      ok: true,
      ...(info ? { serverInfo: { name: String(info.name), version: String(info.version) } } : {}),
      tools,
      warnings,
      durationMs: Date.now() - started,
    }
  } catch (err: any) {
    return {
      ok: false,
      tools: [],
      error: maskSecretText(String(err?.message ?? err), secrets).slice(0, MAX_ERROR_LENGTH),
      warnings,
      durationMs: Date.now() - started,
    }
  } finally {
    await client?.close().catch(() => {})
  }
}
