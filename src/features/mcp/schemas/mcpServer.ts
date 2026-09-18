import { z } from 'zod'
import { MCP_MAX_TIMEOUT_MS } from '../business/types.js'

const stringRecord = z.record(z.string(), z.string())

const baseFields = {
  id: z.string().min(1),
  label: z.string().min(1).max(128).optional(),
  enabled: z.boolean().optional(),
  // Cắt ở biên thay vì lúc dùng: `resolveTimeoutMs` cắt trần âm thầm, nên người
  // dùng gõ 120000, thấy lưu 120000, mà probe vẫn bỏ cuộc ở 60s.
  timeoutMs: z.number().int().positive().max(MCP_MAX_TIMEOUT_MS).optional(),
}

const StdioFields = z.object({
  ...baseFields,
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: stringRecord.optional(),
  cwd: z.string().optional(),
})

const RemoteFields = z.object({
  ...baseFields,
  transport: z.enum(['http', 'sse']),
  url: z.string().min(1),
  credentialId: z.string().nullable().optional(),
  authHeader: z.string().optional(),
  authScheme: z.string().optional(),
  headers: stringRecord.optional(),
})

export const McpServerUpsertSchema = z.discriminatedUnion('transport', [StdioFields, RemoteFields])
export type McpServerUpsertInput = z.infer<typeof McpServerUpsertSchema>

/** Test nhận cả bản nháp chưa lưu — `id` vẫn bắt buộc để `recordCheckResult` bám được. */
export const McpServerTestSchema = z.object({
  server: McpServerUpsertSchema,
  listTools: z.boolean().optional(),
})
export type McpServerTestInput = z.infer<typeof McpServerTestSchema>

