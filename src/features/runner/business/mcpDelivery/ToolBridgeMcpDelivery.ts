// Cầu nối tool MCP vào vòng tool-use của họ `ai-api`.
//
// Khác hẳn hai cách giao bằng file: ở đó CLI tự nói chuyện với MCP server,
// dashboard chỉ sinh file cấu hình. Họ `ai-api` KHÔNG có CLI nào ở giữa —
// dashboard chính là vòng tool-use, nên nó phải tự mở client MCP, khai tool với
// SDK và route lời gọi.
//
// Mở ở base class (`AgenticApiProvider`) chứ không ở từng subclass: vòng tool-use
// là đường MỌI job `ai-api` đi qua, kể cả job không liên quan MCP, và một chỗ
// quên `close()` là rò tiến trình con stdio theo từng job.

import {
  McpClient,
  SecretMasker,
  type CredentialResolver,
  type McpServerSet,
  type McpSession,
} from '../../../mcp/business/index.js'
import { McpJobDelivery, type McpJobInput } from './McpJobDelivery.js'

/** Khớp quy ước tên tool của Claude Code — `mcp__<server>__<tool>`. */
const MCP_TOOL_PREFIX = 'mcp__'
/** Hạn mặc định của MỘT lời gọi tool — `constructor` nhận giá trị khác (test). */
export const MCP_TOOL_CALL_TIMEOUT_MS = 60_000

export interface McpBridgeTool {
  name: string
  description: string
  inputSchema: unknown
}

interface McpToolCallOutcome {
  ok: boolean
  error?: string
  result?: unknown
}

export interface McpToolBridge {
  tools: McpBridgeTool[]
  /** Giá trị cần mask trước khi ghi kết quả tool / lỗi vào log job. */
  masker: SecretMasker
  has(name: string): boolean
  call(name: string, args: Record<string, unknown>): Promise<McpToolCallOutcome>
  close(): Promise<void>
}

/**
 * Bridge `null` khi job không bật MCP server nào — và đó là đường mặc định phải
 * giữ nguyên: bridge `null` ⇒ danh sách `tools` và preamble y hệt hiện tại,
 * không một byte nào đổi cho job `ai-api` không liên quan MCP.
 */
export class ToolBridgeMcpDelivery extends McpJobDelivery<McpToolBridge> {
  readonly kind = 'bridge-tools' as const

  /**
   * @param credentials giải `credentialId` của server từ xa thành secret.
   * @param callTimeoutMs hạn mỗi lời gọi tool — tiêm từ test.
   */
  constructor(
    private readonly credentials: CredentialResolver,
    private readonly callTimeoutMs: number = MCP_TOOL_CALL_TIMEOUT_MS,
  ) {
    super()
  }

  protected async attach(set: McpServerSet, input: McpJobInput): Promise<McpToolBridge | null> {
    const warn = (message: string) => input.onWarning?.(message)
    const sessions = new Map<string, McpSession>()
    const routes = new Map<string, { session: McpSession; toolName: string }>()
    const tools: McpBridgeTool[] = []
    let collected = SecretMasker.NONE

    for (const server of set.servers) {
      const key = server.key
      if (!key) {
        warn(`mcp ${server.id}: id không hợp lệ — bỏ qua server này`)
        continue
      }
      // Secret của credential phải nằm trong danh sách mask của chính thông điệp
      // lỗi bên dưới — server từ xa vọng lại token trong body 401 là chuyện
      // thường. `resolve` là chỗ DUY NHẤT giải credential (stdio ⇒ `null`).
      const credentialSecret = server.resolve({ credentials: this.credentials }).secret
      const knownMasker = new SecretMasker([
        ...server.secretValues(),
        ...(credentialSecret ? [credentialSecret] : []),
      ])

      let session: McpSession
      try {
        session = await McpClient.open(server, {
          cwd: input.workspace,
          // Nhận ngay lúc phát sinh: `open` ném thì 🚫 không có `session` nào để
          // đọc `warnings`, mà đó đúng là ca cần giải thích nhất.
          onWarning: (message) => warn(`mcp ${server.id}: ${message}`),
          // 📌 BẮT BUỘC. Thiếu nó thì server có `credentialId` bị BỎ HẲN header
          // xác thực, server trả 401, bridge trả `null` và model mất sạch tool —
          // tức bridge vô hiệu với đúng cấu hình mà cảnh báo `argsSecretLiteral`
          // đang khuyên dùng. Đường CLI giải cùng `credentials` này
          // (`FileMcpDelivery`).
          credentials: this.credentials,
        })
      } catch (err: any) {
        // Một server hỏng 🚫 không được làm chết cả job: nó chỉ mất đúng tool của
        // nó. Thông điệp lỗi có thể vọng lại secret nên mask trước khi ra log.
        warn(`mcp ${server.id}: không mở được phiên — ${knownMasker.mask(String(err?.message ?? err))}`)
        continue
      }
      sessions.set(key, session)
      collected = collected.with(session.masker.values, knownMasker.values)
      for (const tool of session.tools) {
        if (!tool.name) continue
        // Prefix vừa chống trùng với tool sẵn có (`run_command`, `git_diff`, …)
        // vừa chống trùng giữa hai server, vì `key` đã nằm giữa.
        const name = `${MCP_TOOL_PREFIX}${key}__${tool.name}`
        routes.set(name, { session, toolName: tool.name })
        tools.push({ name, description: tool.description, inputSchema: tool.inputSchema ?? { type: 'object' } })
      }
    }

    if (!sessions.size) return null

    const masker = collected
    const timeoutMs = this.callTimeoutMs
    return {
      tools,
      masker,
      has: (name) => routes.has(name),
      async call(name, args) {
        const route = routes.get(name)
        if (!route) return { ok: false, error: `tool ${name} không tồn tại` }
        try {
          const result = await McpClient.withTimeout(
            route.session.callTool(route.toolName, args ?? {}),
            timeoutMs,
            `mcp: tool ${name} quá hạn ${timeoutMs}ms`,
          )
          // Kết quả tool đi thẳng vào log job và vào `messages` được persist, nên
          // secret phải bị thay TRƯỚC khi nó rời hàm này.
          return { ok: true, result: masker.maskDeep(result) }
        } catch (err: any) {
          // 🚫 Không bao giờ ném: vòng tool-use coi đây là `is_error` và model tự
          // xử, thay vì cả job chết vì một server MCP hỏng giữa chừng.
          return { ok: false, error: masker.mask(String(err?.message ?? err)) }
        }
      },
      async close() {
        for (const session of sessions.values()) {
          await session.close().catch(() => {})
        }
        sessions.clear()
        routes.clear()
      },
    }
  }
}
