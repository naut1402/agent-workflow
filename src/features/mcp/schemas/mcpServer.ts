import { z } from 'zod'
import { MCP_MAX_TIMEOUT_MS } from '../business/types.js'

const stringRecord = z.record(z.string(), z.string())

const baseFields = {
  id: z.string().min(1),
  label: z.string().min(1).max(128).optional(),
  enabled: z.boolean().optional(),
  // Cắt ở biên thay vì lúc dùng: `resolveTimeoutMs` cắt trần âm thầm, nên không
  // chặn ở đây thì người dùng gõ quá trần, thấy lưu nguyên giá trị, mà probe vẫn
  // bỏ cuộc sớm hơn. 🚫 Không thêm `.min()`: bản ghi v1 có thể giữ giá trị dưới sàn
  // của CLI, chặn ở đây là biến một cú bấm Lưu thành lỗi khó hiểu — việc kẹp về
  // miền `[5s, 600s]` xảy ra lúc sinh file config (`serialize.ts`).
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

/** Test nhận cả bản nháp chưa lưu — `id` vẫn bắt buộc để `recordCheckResult` bám được. */
export const McpServerTestSchema = z.object({
  server: McpServerUpsertSchema,
  listTools: z.boolean().optional(),
})

