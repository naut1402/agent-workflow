// Cầu nối tool MCP vào vòng tool-use của họ `ai-api`.
//
// Khác hẳn hai nhánh `agent-cli`: ở đó CLI tự nói chuyện với MCP server, dashboard
// chỉ sinh file cấu hình. Họ `ai-api` KHÔNG có CLI nào ở giữa — dashboard chính là
// vòng tool-use, nên nó phải tự mở client MCP, khai tool với SDK và route lời gọi.
//
// Mở ở base class (`AgenticApiProvider`) chứ không ở từng subclass: vòng tool-use
// là đường MỌI job `ai-api` đi qua, kể cả job không liên quan MCP, và một chỗ
// quên `close()` là rò tiến trình con stdio theo từng job.

import {
  collectSecretValues,
  listMcpServers,
  maskSecretText,
  openMcpSession,
  sanitiseMcpServerId,
} from '../../../mcp/business/index.js'
import type { McpSession } from '../../../mcp/business/index.js'
import type { McpServerConfig } from '../../../mcp/business/types.js'
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
  const ids = Array.isArray(input.ids) ? input.ids.filter((x): x is string => typeof x === 'string') : []
  if (!ids.length) return null

  const warn = (message: string) => input.onWarning?.(message)
  const servers = listMcpServers().filter((s) => ids.includes(s.id) && s.enabled)
  const resolved = new Set(servers.map((s) => s.id))
  for (const id of ids) {
    if (!resolved.has(id)) warn(`mcp ${id}: không tìm thấy hoặc đang tắt — job chạy không có server này`)
  }
  if (!servers.length) return null

  const sessions = new Map<string, McpSession>()
  const routes = new Map<string, { session: McpSession; toolName: string }>()
  const tools: McpBridgeTool[] = []
  const secrets: string[] = []

  for (const server of servers) {
    const key = sanitiseMcpServerId(server.id)
    if (!key) {
      warn(`mcp ${server.id}: id không hợp lệ — bỏ qua server này`)
      continue
    }
    // Giải một lần: vừa truyền xuống transport, vừa phải nằm trong danh sách
    // mask của chính thông điệp lỗi bên dưới — server từ xa vọng lại token
    // trong body 401 là chuyện thường.
    const credentialSecret = resolveCredentialSecret(server)
    const knownSecrets = [...collectSecretValues(server), ...(credentialSecret ? [credentialSecret] : [])]

    let session: McpSession
    try {
      session = await openMcpSession(server, {
        cwd: input.workspace,
        // Nhận ngay lúc phát sinh: `openMcpSession` ném thì 🚫 không có
        // `session` nào để đọc `warnings`, mà đó đúng là ca cần giải thích nhất.
        onWarning: (message) => warn(`mcp ${server.id}: ${message}`),
        // 📌 BẮT BUỘC. Thiếu nó thì `resolveHeaders` thấy `secret` rỗng + có
        // `credentialId` ⇒ BỎ HẲN header xác thực, server trả 401, bridge trả
        // `null` và model mất sạch tool — tức #379 vô hiệu với đúng cấu hình mà
        // cảnh báo `argsSecretLiteral` đang khuyên dùng. Đường CLI giải ở
        // `mcpJobConfig.ts` (`secretFor`); đường này phải giải tương đương.
        secret: credentialSecret,
      })
    } catch (err: any) {
      // Một server hỏng 🚫 không được làm chết cả job: nó chỉ mất đúng tool của
      // nó. Thông điệp lỗi có thể vọng lại secret nên mask trước khi ra log.
      warn(`mcp ${server.id}: không mở được phiên — ${maskSecretText(String(err?.message ?? err), knownSecrets)}`)
      continue
    }
    sessions.set(key, session)
    secrets.push(...session.secrets, ...knownSecrets)
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
  const uniqueSecrets = [...new Set(secrets)].filter(Boolean)

  return {
    tools,
    secrets: uniqueSecrets,
    has: (name) => routes.has(name),
    async call(name, args) {
      const route = routes.get(name)
      if (!route) return { ok: false, error: `tool ${name} không tồn tại` }
      try {
        const result = await withTimeout(
          route.session.callTool(route.toolName, args ?? {}),
          timeoutMs,
          name,
        )
        return { ok: true, result: maskDeep(result, uniqueSecrets) }
      } catch (err: any) {
        // 🚫 Không bao giờ ném: vòng tool-use coi đây là `is_error` và model tự
        // xử, thay vì cả job chết vì một server MCP hỏng giữa chừng.
        return { ok: false, error: maskSecretText(String(err?.message ?? err), uniqueSecrets) }
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
 * Kết quả tool đi thẳng vào log job và vào `messages` được persist, nên secret
 * phải bị thay TRƯỚC khi nó rời hàm này — ràng buộc này áp cho cả họ `ai-api`,
 * không riêng `agent-cli` (ở đó `maskLog` lo phần tương ứng).
 */
function maskDeep(value: unknown, secrets: readonly string[]): unknown {
  if (!secrets.length) return value
  if (typeof value === 'string') return maskSecretText(value, secrets)
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, secrets))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = maskDeep(v, secrets)
    return out
  }
  return value
}

/**
 * Secret của credential profile, giải y hệt đường CLI (`mcpJobConfig.ts`) và
 * đường Kiểm tra kết nối (`controller.ts`). `null` cho stdio: credential chỉ
 * gắn vào header của transport từ xa.
 */
function resolveCredentialSecret(server: McpServerConfig): string | null {
  if (server.transport === 'stdio' || !server.credentialId) return null
  const resolved = resolveSecretRef(getCredential(server.credentialId))
  if (!isDirectSecretType(resolved.type)) return null
  return (resolved as { value?: string | null }).value ?? null
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`mcp: tool ${label} quá hạn ${ms}ms`)), ms)
  })
  return Promise.race([promise, guard]).finally(() => {
    if (timer) clearTimeout(timer)
  }) as Promise<T>
}
