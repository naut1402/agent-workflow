// xem docs/mcp/client.md §9

import { z } from 'zod'

/** Phiên bản store `mcp-servers.json`. */
export const MCP_SERVERS_VERSION = 2

/** Mặc định `startupTimeoutSec` của Claude Code CLI; CLI nhận miền [5s, 600s]. */
export const MCP_DEFAULT_TIMEOUT_MS = 120_000
export const MCP_MAX_TIMEOUT_MS = 600_000
export const MCP_MIN_TIMEOUT_MS = 5_000
const MCP_STDIO_TRANSPORT = 'stdio'
const MCP_REMOTE_TRANSPORTS = ['http', 'sse'] as const
export const MCP_TRANSPORTS = [MCP_STDIO_TRANSPORT, ...MCP_REMOTE_TRANSPORTS] as const
export type McpTransport = (typeof MCP_TRANSPORTS)[number]
export const MCP_DEFAULT_HTTP_PATH = '/mcp'
export const MCP_DEFAULT_SSE_PATH = '/sse'
export const MCP_DEFAULT_AUTH_HEADER = 'Authorization'
export const MCP_DEFAULT_AUTH_SCHEME = 'Bearer'

/** Tối đa 50 tên tool được lưu lại, mỗi tên cắt 120 ký tự. */
export const MCP_MAX_TOOL_NAMES = 50
export const MCP_MAX_TOOL_NAME_LENGTH = 120
export const MCP_MAX_TOOL_DESCRIPTION_LENGTH = 200

/** `env:NAME` — tham chiếu biến môi trường, không phải giá trị secret. */
export const MCP_ENV_REF_PATTERN = /^env:([A-Za-z_][A-Za-z0-9_]*)$/

const stringRecord = z.record(z.string(), z.string())

// xem docs/architecture/code/mcp.md §2

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
  /** Chỉ dùng cho `McpClient.probe` — không đi vào file cấu hình CLI. */
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

const baseFields = {
  id: z.string().min(1),
  label: z.string().min(1).max(128).optional(),
  enabled: z.boolean().optional(),
  // xem docs/mcp/client.md §3.1
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
