import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FetchLike, Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { assertMcpEndpoint } from './endpointGuard.js'
import { resolveEnvRefs, resolveHeaders } from './resolveRefs.js'
import {
  MCP_MAX_TOOL_DESCRIPTION_LENGTH,
  MCP_MAX_TOOL_NAMES,
  isMaskableSecret,
  isStdioServer,
  looksLikeSecretLiteral,
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

/**
 * `timeoutMs` là NGÂN SÁCH TỔNG cho cả lượt kiểm tra, không phải hạn mức từng bước:
 * `connect` và `tools/list` chia chung một deadline. Cấp trọn `timeoutMs` cho mỗi
 * bước thì xấu nhất người dùng chờ 2×, mà mặc định nay là 120s (khớp
 * `startupTimeoutSec` của CLI) trên một nút 🚫 không huỷ được ⇒ 4 phút đứng hình.
 *
 * Hết ngân sách thì trả 0: `withTimeout` bỏ cuộc ngay thay vì cấp thêm giờ.
 */
function remainingMs(deadline: number): number {
  return Math.max(0, deadline - Date.now())
}

function fetchWithHeaders(headers: Record<string, string>): FetchLike {
  return (url, init) =>
    fetch(url, {
      ...init,
      headers: { ...Object.fromEntries(new Headers(init?.headers).entries()), ...headers },
    })
}

/**
 * Full `process.env` chứ 🚫 KHÔNG `getDefaultEnvironment()` (6 biến): job thật spawn
 * `claude` với `{...process.env}` và Claude Code truyền nguyên env đó xuống MCP
 * server. Probe hẹp hơn là probe một cấu hình KHÁC cấu hình sẽ chạy — đúng bug
 * «kiểm tra fail nhưng agent vẫn lấy được tool» người dùng báo.
 *
 * Lọc giá trị không phải chuỗi: `process.env` có thể mang `undefined` ở khoá đã
 * xoá, mà `StdioClientTransport` cần `Record<string, string>`.
 */
function fullProcessEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}

interface TransportPlan {
  transport: Transport
  secrets: string[]
  warnings: string[]
}

function buildTransport(server: McpServerConfig, opts: McpProbeOptions): TransportPlan {
  if (isStdioServer(server)) {
    const resolved = resolveEnvRefs(server.env)
    const hostEnv = fullProcessEnv()
    return {
      transport: new StdioClientTransport({
        command: server.command,
        args: server.args ?? [],
        // `server.env` spread sau nên thắng khi trùng khoá — giữ đúng hành vi cũ và
        // khớp cách CLI dựng env cho server con.
        env: { ...hostEnv, ...resolved.env },
        cwd: server.cwd || opts.cwd || process.cwd(),
        stderr: 'pipe',
      }),
      secrets: [
        // Giá trị người dùng khai trong dialog: ngưỡng `isMaskableSecret` (chỉ theo
        // độ dài) vì mọi giá trị ở đây đều do người dùng gõ cho server này.
        ...Object.values(resolved.env).filter(isMaskableSecret),
        // Giá trị của HOST: từ khi probe bơm full `process.env` xuống tiến trình con,
        // `ANTHROPIC_API_KEY`/`DASHBOARD_SECRET_KEY` nằm trong tầm với của server con —
        // nó vọng lại một giá trị nào đó vào thông điệp lỗi là chuỗi đó ra thẳng dialog
        // và bị persist vào `lastCheck.error` (`registry.ts`). Trước đây con chỉ nhận 6
        // biến nên không có gì để vọng; giờ có, nên danh sách mask phải phủ theo.
        //
        // Lọc theo TÊN KHOÁ (`looksLikeSecretLiteral`) chứ 🚫 không theo `isMaskableSecret`:
        // ngưỡng độ dài đơn thuần nuốt cả `PATH`/`HOME`/`PWD` — đúng thứ duy nhất người
        // dùng có để sửa cấu hình.
        ...Object.entries(hostEnv)
          .filter(([key, value]) => looksLikeSecretLiteral(key, value))
          .map(([, value]) => value),
      ],
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
    secrets: Object.values(headers).filter(isMaskableSecret),
    warnings: resolved.warnings,
  }
}

/**
 * Kết nối thật tới MCP server để kiểm tra cấu hình. Không bao giờ ném: lỗi trả
 * về trong `error` đã mask secret. `client.close()` trong `finally` là thứ giết
 * tiến trình con của transport stdio.
 *
 * `timeoutMs` hiệu lực là ngân sách cho CẢ lượt — xem `remainingMs`.
 */
export async function probeMcpServer(
  server: McpServerConfig,
  opts: McpProbeOptions = {},
): Promise<McpProbeResult> {
  const started = Date.now()
  const deadline = started + resolveTimeoutMs(opts.timeoutMs, server.timeoutMs)
  let secrets: string[] = []
  let client: Client | null = null
  const warnings: string[] = []

  try {
    const plan = buildTransport(server, opts)
    secrets = plan.secrets
    warnings.push(...plan.warnings)

    client = new Client(CLIENT_INFO, { capabilities: {} })
    await withTimeout(client.connect(plan.transport), remainingMs(deadline), 'connect')
    const info = client.getServerVersion()

    let tools: McpProbeTool[] = []
    if (opts.listTools) {
      const listed = await withTimeout(client.listTools(), remainingMs(deadline), 'tools/list')
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
