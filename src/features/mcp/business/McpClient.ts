import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { MCP_MAX_TOOL_DESCRIPTION_LENGTH, MCP_MAX_TOOL_NAMES } from '../schemas/mcpServer.js'
import type { CredentialResolver } from './CredentialResolver.js'
import type { McpServer } from './McpServer.js'
import { SecretMasker } from './SecretMasker.js'
import { SelfMcpServer } from './SelfMcpServer.js'

const CLIENT_INFO = { name: SelfMcpServer.SERVER_ID, version: '1.0.0' }
const MAX_ERROR_LENGTH = 500

export interface McpProbeTool {
  name: string
  description: string
  /** JSON Schema của tham số — chỉ `McpClient.open` điền. */
  inputSchema?: unknown
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
  /** Giải secret của credential profile — caller (controller/runner) tiêm vào. */
  credentials?: CredentialResolver | null
  /** Nhận cảnh báo lúc dựng transport, ngay khi phát sinh — trước `connect()`. */
  onWarning?: (message: string) => void
}

// xem docs/architecture/code/mcp.md §1
function remainingMs(deadline: number): number {
  return Math.max(0, deadline - Date.now())
}

/** Phiên MCP sống theo job — caller gọi `close()` trong `finally`. */
export class McpSession {
  constructor(
    private readonly client: Client,
    readonly tools: McpProbeTool[],
    /** Che giá trị của phiên này trước khi ghi bất cứ thứ gì của nó vào log. */
    readonly masker: SecretMasker,
  ) {}

  callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.client.callTool({ name, arguments: args })
  }

  close(): Promise<void> {
    return this.client.close().catch(() => {})
  }
}

/** Kết nối MCP vai client — dùng `McpServer.createTransport`, không tự rẽ nhánh transport. */
export class McpClient {
  /** `message` do caller đặt — mỗi đường giữ thông điệp quá hạn riêng của nó. */
  static withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const guard = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms)
    })
    return Promise.race([promise, guard]).finally(() => {
      if (timer) clearTimeout(timer)
    }) as Promise<T>
  }

  /** Kết nối thật để kiểm tra cấu hình; không ném — lỗi trả trong `error` đã mask secret. */
  static async probe(server: McpServer, opts: McpProbeOptions = {}): Promise<McpProbeResult> {
    const started = Date.now()
    const deadline = started + server.timeoutMs(opts.timeoutMs)
    let masker = SecretMasker.NONE
    let client: Client | null = null
    const warnings: string[] = []

    try {
      const plan = server.createTransport(opts)
      masker = new SecretMasker(plan.secrets)
      warnings.push(...plan.warnings)

      client = new Client(CLIENT_INFO, { capabilities: {} })
      const connecting = client.connect(plan.transport)
      const connectMs = remainingMs(deadline)
      await McpClient.withTimeout(connecting, connectMs, `mcp: connect timed out after ${connectMs}ms`)
      const info = client.getServerVersion()

      let tools: McpProbeTool[] = []
      if (opts.listTools) {
        const listing = client.listTools()
        const listMs = remainingMs(deadline)
        const listed = await McpClient.withTimeout(listing, listMs, `mcp: tools/list timed out after ${listMs}ms`)
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
        error: masker.mask(String(err?.message ?? err)).slice(0, MAX_ERROR_LENGTH),
        warnings,
        durationMs: Date.now() - started,
      }
    } finally {
      await client?.close().catch(() => {})
    }
  }

  /** Mở phiên giữ kết nối cho vòng tool-use; ném khi `connect` hoặc `tools/list` lỗi. */
  static async open(server: McpServer, opts: McpProbeOptions = {}): Promise<McpSession> {
    // xem docs/architecture/code/mcp.md §1
    const timeoutMs = server.timeoutMs(opts.timeoutMs)
    const plan = server.createTransport(opts)
    for (const message of plan.warnings) opts.onWarning?.(message)
    const client = new Client(CLIENT_INFO, { capabilities: {} })

    try {
      await McpClient.withTimeout(
        client.connect(plan.transport),
        timeoutMs,
        `mcp: connect timed out after ${timeoutMs}ms`,
      )
      const listed = await McpClient.withTimeout(
        client.listTools(),
        timeoutMs,
        `mcp: tools/list timed out after ${timeoutMs}ms`,
      )
      const tools: McpProbeTool[] = (listed.tools ?? []).slice(0, MCP_MAX_TOOL_NAMES).map((tool) => ({
        name: String(tool.name ?? ''),
        description: String(tool.description ?? '').slice(0, MCP_MAX_TOOL_DESCRIPTION_LENGTH),
        inputSchema: tool.inputSchema,
      }))

      return new McpSession(client, tools, new SecretMasker(plan.secrets))
    } catch (err) {
      await client.close().catch(() => {})
      throw err
    }
  }
}
