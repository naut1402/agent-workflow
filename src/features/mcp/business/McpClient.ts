import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { MCP_MAX_TOOL_DESCRIPTION_LENGTH, MCP_MAX_TOOL_NAMES } from '../schemas/mcpServer.js'
import type { CredentialResolver } from './CredentialResolver.js'
import type { McpServer } from './McpServer.js'
import { SecretMasker } from './SecretMasker.js'
// Không thành vòng: `SelfMcpServer` → `StdioMcpServer` → `McpServer` 🚫 import
// file này, nên hằng đã khởi tạo xong trước khi dòng dưới chạy.
import { SelfMcpServer } from './SelfMcpServer.js'

/** Dashboard tự xưng cùng một tên ở cả hai vai — client và server stdio. */
const CLIENT_INFO = { name: SelfMcpServer.SERVER_ID, version: '1.0.0' }
const MAX_ERROR_LENGTH = 500

export interface McpProbeTool {
  name: string
  description: string
  /**
   * JSON Schema của tham số, CHỈ `McpClient.open` điền. `McpClient.probe` để
   * trống có chủ ý: kết quả probe chảy thẳng ra `GET /api/mcp-servers/test` và
   * được persist vào `lastCheck`, mà schema tool là payload lớn, không ai đọc ở
   * đó. Vòng tool-use thì bắt buộc có nó để khai tool với SDK.
   */
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
  /**
   * Nhận cảnh báo lúc DỰNG transport, ngay khi phát sinh.
   *
   * 📌 Phải là callback chứ 🚫 không thể chỉ nằm trong giá trị trả về: cảnh báo
   * quan trọng nhất ("credential … không giải được secret — bỏ header xác thực")
   * sinh ra TRƯỚC `connect()`, và chính nó là nguyên nhân làm `connect()` ném
   * 401/timeout. Đường trả về 🚫 không bao giờ chạy ở đúng ca cần giải thích nhất.
   */
  onWarning?: (message: string) => void
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

/**
 * Phiên MCP sống theo JOB, khác `McpClient.probe` (mở–đo–đóng trong một lần gọi).
 * Vòng tool-use của `ai-api` cần giữ client mở suốt cuộc hội thoại để gọi tool
 * nhiều lần, nên vòng đời do caller quản — và `close()` PHẢI ở trong `finally`:
 * transport stdio là một tiến trình con, quên đóng là rò tiến trình theo từng job.
 */
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

/** Kết nối MCP vai client — dùng `McpServer.createTransport`, 🚫 không tự rẽ nhánh transport. */
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

  /**
   * Kết nối thật tới MCP server để kiểm tra cấu hình. Không bao giờ ném: lỗi trả
   * về trong `error` đã mask secret. `client.close()` trong `finally` là thứ giết
   * tiến trình con của transport stdio.
   *
   * `timeoutMs` hiệu lực là ngân sách cho CẢ lượt — xem `remainingMs`.
   */
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

  /**
   * Mở phiên giữ kết nối cho vòng tool-use. Dùng lại `createTransport` nguyên vẹn
   * ⇒ guard endpoint, danh sách mask và cách dựng env của phiên này giống hệt
   * đường probe, không có bản thứ hai để lệch.
   */
  static async open(server: McpServer, opts: McpProbeOptions = {}): Promise<McpSession> {
    // 📌 `opts.listTools` KHÔNG áp dụng ở đây: phiên này sinh ra để nối tool vào
    // vòng tool-use, mà không có `tools/list` thì 🚫 không có gì để nối. Caller
    // muốn chỉ thử kết nối thì dùng `probe`.
    const timeoutMs = server.timeoutMs(opts.timeoutMs)
    const plan = server.createTransport(opts)
    // Đẩy ra NGAY, trước `connect()` — xem `McpProbeOptions.onWarning`.
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
      // Mở hụt thì đóng ngay tại đây: caller nhận exception và không có handle nào
      // để gọi `close()`, nên tiến trình con của transport stdio sẽ ở lại mãi.
      await client.close().catch(() => {})
      throw err
    }
  }
}
