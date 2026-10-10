// Nguồn kiểu DUY NHẤT của feature `mcp`: hằng shape, schema Zod của bản ghi và
// của payload API, cùng type sinh bằng `z.infer`. Browser-safe — FE import thẳng
// file này (`components/*.vue`, `scripts/mcpApi.ts`), nên 🚫 không chạm `node:*`
// hay SDK MCP.

import { z } from 'zod'

/**
 * Ngữ nghĩa `timeoutMs` đổi ở v2: v1 nó chỉ tác động nút Kiểm tra kết nối, v2 nó
 * còn được ghi xuống `startupTimeoutSec` của file config CLI nên tác động cả lúc
 * job chạy server. Không có cờ version thì không phân biệt được «15000 là mặc
 * định cũ chưa ai đụng» với «15000 do người dùng cố ý đặt sau khi lên v2».
 */
export const MCP_SERVERS_VERSION = 2

/**
 * Khớp `startupTimeoutSec` của Claude Code CLI — đã đọc lại schema trên bản 2.1.267
 * đang cài: `z.coerce.number().int().min(5).max(600).optional()`, `default: 120`,
 * chỉ hiện với `transport === 'stdio'`.
 */
export const MCP_DEFAULT_TIMEOUT_MS = 120_000
export const MCP_MAX_TIMEOUT_MS = 600_000
export const MCP_MIN_TIMEOUT_MS = 5_000
/** Transport spawn tiến trình con — `StdioMcpServer`. */
const MCP_STDIO_TRANSPORT = 'stdio'
/** Transport qua mạng — `RemoteMcpServer` phục vụ cả hai. */
const MCP_REMOTE_TRANSPORTS = ['http', 'sse'] as const
export const MCP_TRANSPORTS = [MCP_STDIO_TRANSPORT, ...MCP_REMOTE_TRANSPORTS] as const
export type McpTransport = (typeof MCP_TRANSPORTS)[number]
export const MCP_DEFAULT_HTTP_PATH = '/mcp'
export const MCP_DEFAULT_SSE_PATH = '/sse'
export const MCP_DEFAULT_AUTH_HEADER = 'Authorization'
export const MCP_DEFAULT_AUTH_SCHEME = 'Bearer'

/** Tối đa 50 tên tool được lưu lại, mỗi tên cắt 120 ký tự (D6). */
export const MCP_MAX_TOOL_NAMES = 50
export const MCP_MAX_TOOL_NAME_LENGTH = 120
export const MCP_MAX_TOOL_DESCRIPTION_LENGTH = 200

/** `env:NAME` — tham chiếu biến môi trường, không phải giá trị secret. */
export const MCP_ENV_REF_PATTERN = /^env:([A-Za-z_][A-Za-z0-9_]*)$/

const stringRecord = z.record(z.string(), z.string())

// ── Bản ghi đã chuẩn hoá (`mcp-servers.json`, response API) ─────────────────
//
// Mô tả shape SAU `McpRegistry.normalise`, 🚫 không phải cổng parse của đường
// đọc: file registry là dữ liệu ngoài, và luật bỏ bản ghi hỏng (guard theo từng
// transport) nằm ở `StdioMcpServer.normalise` / `RemoteMcpServer.normalise`.

export const McpCheckSummarySchema = z.object({
  at: z.string(),
  ok: z.boolean(),
  toolCount: z.number(),
  toolNames: z.array(z.string()),
  error: z.string().optional(),
})
export type McpCheckSummary = z.infer<typeof McpCheckSummarySchema>

const recordBaseFields = {
  id: z.string(),
  label: z.string(),
  enabled: z.boolean(),
  timeoutMs: z.number().optional(),
  /** Tóm tắt lần kiểm tra gần nhất — không lưu schema tool. */
  lastCheck: McpCheckSummarySchema.nullable().optional(),
}

export const McpStdioServerSchema = z.object({
  ...recordBaseFields,
  transport: z.literal(MCP_STDIO_TRANSPORT),
  command: z.string(),
  args: z.array(z.string()),
  /** Giá trị literal hoặc tham chiếu `env:NAME` — không bao giờ là secret đã giải. */
  env: stringRecord,
  /**
   * Chỉ dùng cho `McpClient.probe`. Cấu hình `mcpServers` của Claude Code không
   * có khoá `cwd`, nên `toCliEntry` bỏ qua và server con kế thừa cwd của CLI.
   */
  cwd: z.string().optional(),
})
export type McpStdioServer = z.infer<typeof McpStdioServerSchema>

export const McpRemoteServerSchema = z.object({
  ...recordBaseFields,
  transport: z.enum(MCP_REMOTE_TRANSPORTS),
  url: z.string(),
  credentialId: z.string().nullable().optional(),
  authHeader: z.string().optional(),
  authScheme: z.string().optional(),
  headers: stringRecord,
})
export type McpRemoteServer = z.infer<typeof McpRemoteServerSchema>

export const McpServerConfigSchema = z.discriminatedUnion('transport', [
  McpStdioServerSchema,
  McpRemoteServerSchema,
])
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>

// ── Payload API (`POST /api/mcp-servers`, `POST /api/mcp-servers/test`) ──────

const baseFields = {
  id: z.string().min(1),
  label: z.string().min(1).max(128).optional(),
  enabled: z.boolean().optional(),
  // Cắt ở biên thay vì lúc dùng: `resolveTimeoutMs` cắt trần âm thầm, nên không
  // chặn ở đây thì người dùng gõ quá trần, thấy lưu nguyên giá trị, mà probe vẫn
  // bỏ cuộc sớm hơn. 🚫 Không thêm `.min()`: bản ghi v1 có thể giữ giá trị dưới sàn
  // của CLI, chặn ở đây là biến một cú bấm Lưu thành lỗi khó hiểu — việc kẹp về
  // miền `[5s, 600s]` xảy ra lúc sinh file config (`StdioMcpServer.toCliEntry`).
  timeoutMs: z.number().int().positive().max(MCP_MAX_TIMEOUT_MS).optional(),
}

const StdioFields = z.object({
  ...baseFields,
  transport: z.literal(MCP_STDIO_TRANSPORT),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: stringRecord.optional(),
  cwd: z.string().optional(),
})

const RemoteFields = z.object({
  ...baseFields,
  transport: z.enum(MCP_REMOTE_TRANSPORTS),
  url: z.string().min(1),
  credentialId: z.string().nullable().optional(),
  authHeader: z.string().optional(),
  authScheme: z.string().optional(),
  headers: stringRecord.optional(),
})

export const McpServerUpsertSchema = z.discriminatedUnion('transport', [StdioFields, RemoteFields])

/** Test nhận cả bản nháp chưa lưu — `id` vẫn bắt buộc để `recordCheck` bám được. */
export const McpServerTestSchema = z.object({
  server: McpServerUpsertSchema,
  listTools: z.boolean().optional(),
})
