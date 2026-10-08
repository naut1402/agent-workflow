import { z } from 'zod'
import {
  MCP_MAX_TIMEOUT_MS,
  MCP_WARN_ARGS_SECRET_LITERAL,
  collectSecretArgs,
} from '../business/types.js'

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

/**
 * Cảnh báo cấu hình — 🚫 KHÔNG chặn.
 *
 * Vì sao không phải `.superRefine`: mọi issue Zod thêm vào đều làm `safeParse`
 * trả `success: false`, tức biến cảnh báo thành 400. Mà literal secret trong
 * `args` là thứ ĐÃ nằm trong cấu hình người dùng đang chạy — chặn ở đây nghĩa là
 * một server đang chạy bỗng không bấm Lưu lại được nữa. Đó là một bước migrate,
 * không phải một bản vá (design §3.3). Nên: parse xong thì gọi hàm này, cảnh báo
 * đi kèm response 2xx và người dùng tự quyết có chuyển sang credential profile không.
 */
export function collectMcpServerWarnings(input: unknown): string[] {
  const server = input as { transport?: string; args?: string[] } | null
  if (server?.transport !== 'stdio') return []
  return collectSecretArgs(server.args).length ? [MCP_WARN_ARGS_SECRET_LITERAL] : []
}

/** Test nhận cả bản nháp chưa lưu — `id` vẫn bắt buộc để `recordCheckResult` bám được. */
export const McpServerTestSchema = z.object({
  server: McpServerUpsertSchema,
  listTools: z.boolean().optional(),
})

