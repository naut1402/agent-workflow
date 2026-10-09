// Cầu nối tool MCP vào vòng tool-use của họ `ai-api`.
//
// Khác hẳn hai nhánh `agent-cli`: ở đó CLI tự nói chuyện với MCP server, dashboard
// chỉ sinh file cấu hình. Họ `ai-api` KHÔNG có CLI nào ở giữa — dashboard chính là
// vòng tool-use, nên nó phải tự mở client MCP, khai tool với SDK và route lời gọi.
//
// Mở ở base class (`AgenticApiProvider`) chứ không ở từng subclass: vòng tool-use
// là đường MỌI job `ai-api` đi qua, kể cả job không liên quan MCP, và một chỗ
// quên `close()` là rò tiến trình con stdio theo từng job.

import { McpClient, SecretMasker, mcpRegistry } from '../../../mcp/business/index.js'
import type { McpServer, McpSession } from '../../../mcp/business/index.js'
import { getCredential, isDirectSecretType, resolveSecretRef } from '../credentials.js'

/** Khớp quy ước tên tool của Claude Code — `mcp__<server>__<tool>`. */
const MCP_TOOL_PREFIX = 'mcp__'
export const MCP_TOOL_CALL_TIMEOUT_MS = 60_000

export interface McpBridgeTool {
  name: string
  description: string
  inputSchema: unknown
}

export interface McpToolCallOutcome {
  ok: boolean
  error?: string
  result?: unknown
}

export interface McpToolBridge {
  tools: McpBridgeTool[]
  /** Giá trị cần mask trước khi ghi kết quả tool / lỗi vào log job. */
  secrets: string[]
  has(name: string): boolean
  call(name: string, args: Record<string, unknown>): Promise<McpToolCallOutcome>
  close(): Promise<void>
}

export interface OpenMcpToolBridgeInput {
  /** `Connection.config.mcpServers` — id server người dùng đã bật. */
  ids: unknown
  workspace: string
  onWarning?: (message: string) => void
  /** Tiêm từ test; mặc định `MCP_TOOL_CALL_TIMEOUT_MS`. */
  callTimeoutMs?: number
}

/**
 * `null` khi job không bật MCP server nào — và đó là đường mặc định phải giữ
 * nguyên: bridge `null` ⇒ danh sách `tools` và preamble y hệt hiện tại, không
 * một byte nào đổi cho job `ai-api` không liên quan MCP.
 */
export async function openMcpToolBridge(
  input: OpenMcpToolBridgeInput,
): Promise<McpToolBridge | null> {
  const warn = (message: string) => input.onWarning?.(message)
  // Không `ids` ⇒ `null`; id rụng ⇒ cảnh báo; rụng hết ⇒ `null` — cùng luật chọn
  // với đường CLI (`McpRegistry.select`).
  const set = mcpRegistry.select({ ids: input.ids, onWarning: warn })
  if (!set) return null

  const sessions = new Map<string, McpSession>()
  const routes = new Map<string, { session: McpSession; toolName: string }>()
  const tools: McpBridgeTool[] = []
  const secrets: string[] = []

  for (const server of set.servers) {
    const key = server.key
    if (!key) {
      warn(`mcp ${server.id}: id không hợp lệ — bỏ qua server này`)
      continue
    }
    // Giải một lần: vừa truyền xuống transport, vừa phải nằm trong danh sách
    // mask của chính thông điệp lỗi bên dưới — server từ xa vọng lại token
    // trong body 401 là chuyện thường.
    const credentialSecret = resolveCredentialSecret(server)
    const knownSecrets = [...server.secretValues(), ...(credentialSecret ? [credentialSecret] : [])]

    let session: McpSession
    try {
      session = await McpClient.open(server, {
        cwd: input.workspace,
        // Nhận ngay lúc phát sinh: `McpClient.open` ném thì 🚫 không có
        // `session` nào để đọc `warnings`, mà đó đúng là ca cần giải thích nhất.
        onWarning: (message) => warn(`mcp ${server.id}: ${message}`),
        // 📌 BẮT BUỘC. Thiếu nó thì `RemoteMcpServer.resolve` thấy secret rỗng + có
        // `credentialId` ⇒ BỎ HẲN header xác thực, server trả 401, bridge trả
        // `null` và model mất sạch tool — tức #379 vô hiệu với đúng cấu hình mà
        // cảnh báo `argsSecretLiteral` đang khuyên dùng. Đường CLI giải ở
        // `mcpJobConfig.ts` (`runnerCredentials`); đường này phải giải tương đương.
        // Trả đúng secret đã giải ở trên — không giải lần hai.
        credentials: { secretFor: () => credentialSecret },
      })
    } catch (err: any) {
      // Một server hỏng 🚫 không được làm chết cả job: nó chỉ mất đúng tool của
      // nó. Thông điệp lỗi có thể vọng lại secret nên mask trước khi ra log.
      warn(`mcp ${server.id}: không mở được phiên — ${new SecretMasker(knownSecrets).mask(String(err?.message ?? err))}`)
      continue
    }
    sessions.set(key, session)
    secrets.push(...session.masker.values, ...knownSecrets)
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

  const timeoutMs = input.callTimeoutMs ?? MCP_TOOL_CALL_TIMEOUT_MS
  const masker = new SecretMasker(secrets)

  return {
    tools,
    secrets: [...masker.values],
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
        // Kết quả tool đi thẳng vào log job và vào `messages` được persist —
        // xem `SecretMasker.maskDeep`.
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

/**
 * Secret của credential profile, giải y hệt đường CLI (`mcpJobConfig.ts`) và
 * đường Kiểm tra kết nối (`controller.ts`). `null` cho stdio: credential chỉ
 * gắn vào header của transport từ xa.
 */
function resolveCredentialSecret(server: McpServer): string | null {
  const config = server.config
  if (config.transport === 'stdio' || !config.credentialId) return null
  const resolved = resolveSecretRef(getCredential(config.credentialId))
  if (!isDirectSecretType(resolved.type)) return null
  return (resolved as { value?: string | null }).value ?? null
}

