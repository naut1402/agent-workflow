// Kiểu dữ liệu và helper thuần của feature `mcp`. Node-free: FE import trực
// tiếp file này (`components/*.vue`), nên không được chạm `node:*`.

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
export const MCP_TRANSPORTS = ['stdio', 'http', 'sse'] as const
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

/** Key trông như secret + đủ dài ⇒ dialog cảnh báo nên dùng credential profile. */
const SECRET_LIKE_KEY = /authorization|token|key|secret|password/i
const SECRET_LIKE_MIN_LENGTH = 20

export const MCP_MASK = '***'

/**
 * Mã cảnh báo trả qua API. FE map sang i18n (`mcp.warnings.*`) — 🚫 không trả
 * chuỗi đã dịch từ backend: backend không biết người dùng đang xem ngôn ngữ nào.
 */
export const MCP_WARN_ARGS_SECRET_LITERAL = 'args.secretLiteral'
export const MCP_WARN_ARGS_SECRET_DROPPED = 'args.secretDropped'

/**
 * Nhận diện secret trong `stdio.args`. 🚫 KHÔNG dùng `isMaskableSecret` ở đây:
 * ngưỡng 8 ký tự đơn thuần nuốt cả `@modelcontextprotocol/server-filesystem` và
 * mọi đường dẫn — mask chúng là làm hỏng đúng thứ người dùng cần để sửa cấu hình.
 *
 * Ba dạng được tính là secret, và chỉ ba dạng đó:
 *   1. giá trị đứng ngay sau một cờ mang tên secret (`--token sk-…`)
 *   2. dạng gộp `--token=sk-…`
 *   3. giá trị tự nó mang hình dạng token đã biết (`sk-`, `ghp_`, JWT, …)
 */
const SECRET_ARG_FLAG =
  /^--?(token|api[-_]?key|key|secret|password|passwd|pwd|auth|access[-_]?token|bearer)$/i
const SECRET_ARG_INLINE =
  /^(--?(?:token|api[-_]?key|key|secret|password|passwd|pwd|auth|access[-_]?token|bearer))=(.+)$/i
const SECRET_VALUE_SHAPE =
  /^(sk-|sk_|ghp_|gho_|github_pat_|xox[baprs]-|AIza|ya29\.|eyJ[A-Za-z0-9_-]{10,}\.)/

/** Một vị trí trong `args` được coi là mang secret. */
export interface SecretArgHit {
  index: number
  value: string
  /** Cờ đi kèm khi hit ở dạng gộp `--flag=value` — dùng để dựng lại `--flag=***`. */
  flag?: string
}

export function collectSecretArgs(args?: readonly string[]): SecretArgHit[] {
  const hits: SecretArgHit[] = []
  const list = args ?? []
  for (let i = 0; i < list.length; i++) {
    const arg = list[i]
    if (typeof arg !== 'string') continue
    // Bản thân sentinel không phải secret — không thì mọi vòng round-trip
    // (`lấy về đã mask → bấm Lưu`) đều báo động giả.
    if (arg === MCP_MASK || arg.endsWith(`=${MCP_MASK}`)) continue
    const inline = SECRET_ARG_INLINE.exec(arg)
    if (inline) {
      hits.push({ index: i, value: inline[2], flag: inline[1] })
      continue
    }
    // `!arg.startsWith('-')` — `--token --verbose` là cờ bị bỏ trống, không phải secret.
    const prev = i > 0 ? String(list[i - 1] ?? '') : ''
    if (SECRET_ARG_FLAG.test(prev) && !arg.startsWith('-')) {
      hits.push({ index: i, value: arg })
      continue
    }
    if (SECRET_VALUE_SHAPE.test(arg)) hits.push({ index: i, value: arg })
  }
  return hits
}

/**
 * Bản `args` đã thay secret bằng `***`. 🚫 Không lọc `isMaskableSecret` ở đây:
 * với API thì thà che hụt độ dài còn hơn để lộ.
 */
export function maskArgs(args?: readonly string[]): string[] {
  const list = [...(args ?? [])]
  for (const hit of collectSecretArgs(list)) {
    list[hit.index] = hit.flag ? `${hit.flag}=${MCP_MASK}` : MCP_MASK
  }
  return list
}

export interface McpCheckSummary {
  at: string
  ok: boolean
  toolCount: number
  toolNames: string[]
  error?: string
}

interface McpServerBase {
  id: string
  label: string
  enabled: boolean
  timeoutMs?: number
  /** Tóm tắt lần kiểm tra gần nhất — không lưu schema tool. */
  lastCheck?: McpCheckSummary | null
}

export interface McpStdioServer extends McpServerBase {
  transport: 'stdio'
  command: string
  args: string[]
  /** Giá trị literal hoặc tham chiếu `env:NAME` — không bao giờ là secret đã giải. */
  env: Record<string, string>
  /**
   * Chỉ dùng cho `probeMcpServer`. Cấu hình `mcpServers` của Claude Code không
   * có khoá `cwd`, nên serializer bỏ qua và server con kế thừa cwd của CLI.
   */
  cwd?: string
}

export interface McpRemoteServer extends McpServerBase {
  transport: 'http' | 'sse'
  url: string
  credentialId?: string | null
  authHeader?: string
  authScheme?: string
  headers: Record<string, string>
}

export type McpServerConfig = McpStdioServer | McpRemoteServer

export interface McpServersStore {
  version: number
  servers: McpServerConfig[]
}

export function isStdioServer(server: McpServerConfig): server is McpStdioServer {
  return server.transport === 'stdio'
}

export function isRemoteServer(server: McpServerConfig): server is McpRemoteServer {
  return server.transport === 'http' || server.transport === 'sse'
}

/** Cùng luật với `sanitiseRunnerId` — bản sao cố ý, để `mcp` không phụ thuộc `runner`. */
export function sanitiseMcpServerId(id: unknown): string | null {
  if (typeof id !== 'string' || !id.trim()) return null
  if (/[\\/\0]/.test(id)) return null
  const clean = id.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
  return clean || null
}

/**
 * Giá trị do người dùng gõ tay có thể là secret literal — gom để mask log/API.
 * Bỏ `env:NAME` (tên biến, không phải giá trị) và `***` (đã mask rồi): mask
 * chúng chỉ làm log khó đọc mà không che thêm gì.
 */
export function collectSecretValues(server: McpServerConfig): string[] {
  const bag = isStdioServer(server) ? server.env : server.headers
  const values = Object.values(bag || {}).filter(isMaskableSecret)
  if (!isStdioServer(server)) return values
  // Lọc `isMaskableSecret` CHỈ ở nhánh này: danh sách trả về dùng để THAY CHUỖI
  // trong log, mà thay một chuỗi < 8 ký tự là làm log không đọc được nữa.
  // `maskArgs` (đường API) thì ngược lại — không lọc, xem chú thích ở đó.
  return [
    ...values,
    ...collectSecretArgs(server.args)
      .map((hit) => hit.value)
      .filter(isMaskableSecret),
  ]
}

/** Ngưỡng 8 ký tự: chuỗi ngắn hơn trùng ngẫu nhiên với text thường, mask vào là hỏng log. */
export function isMaskableSecret(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 8) return false
  if (value === MCP_MASK) return false
  return !MCP_ENV_REF_PATTERN.test(value)
}

/**
 * Gộp bản gửi lên với bản đang lưu: API trả cấu hình đã mask, nên client gửi
 * ngược lại đúng `***` ở mọi khoá nó không sửa. Coi `***` là sentinel "giữ
 * nguyên" — nếu không, một cú bấm bật/tắt là ghi đè secret thật bằng `***`.
 *
 * Khoá mang `***` mà bản cũ không có thì bỏ hẳn: không có gì để khôi phục, và
 * ghi literal `***` xuống server con còn tệ hơn thiếu khoá.
 */
export function mergeMaskedSecrets<T extends McpServerConfig>(
  next: T,
  previous: McpServerConfig | null | undefined,
  /** Sink tuỳ chọn: nhận mã cảnh báo khi một ô `***` bị bỏ vì neo không khớp. */
  warnings?: string[],
): T {
  if (isStdioServer(next)) {
    const prevStdio = previous && isStdioServer(previous) ? previous : null
    return {
      ...next,
      env: restoreMasked(next.env, prevStdio?.env ?? {}),
      // `undefined` phải ở nguyên `undefined`: hoá nó thành `[]` là làm hỏng bất
      // biến round-trip `mergeMaskedSecrets(maskSecretValues(s), s) === s`.
      ...(next.args === undefined
        ? {}
        : { args: restoreMaskedArgs(next.args, prevStdio?.args, warnings) }),
    } as T
  }
  const prev = previous && isRemoteServer(previous) ? previous.headers : {}
  return { ...next, headers: restoreMasked(next.headers, prev) } as T
}

function restoreMasked(
  next: Record<string, string> | undefined,
  previous: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(next || {})) {
    if (v !== MCP_MASK) {
      out[k] = v
      continue
    }
    if (previous[k] !== undefined) out[k] = previous[k]
  }
  return out
}

/**
 * Bản cho `args`: khác `env`/`headers` ở chỗ không có khoá để ghép, chỉ có vị
 * trí. Vị trí một mình thì không đủ — người dùng chèn/xoá một arg phía trước là
 * mọi ô sau lệch đi một, và khôi phục theo vị trí lệch nghĩa là ghi secret của
 * tham số này vào tham số khác.
 *
 * Nên mỗi dạng mask phải có một NEO chứng minh hai mảng đang nói về cùng tham số:
 *   - dạng gộp `--flag=***` ⇒ `previous[i]` phải bắt đầu bằng đúng `\`${flag}=\``
 *   - dạng vị trí `***`     ⇒ `previous[i - 1]` phải trùng `next[i - 1]` (cờ đứng trước)
 *   - dạng vị trí ở `i === 0` ⇒ không có cờ nào đứng trước để neo, nên neo bằng
 *     "bản cũ CŨNG đang giữ secret ở đúng ô 0". `collectSecretArgs` nhận secret
 *     theo HÌNH DẠNG giá trị (`ghp_…`) ở mọi vị trí, kể cả 0 — thiếu nhánh này
 *     thì `['ghp_…','--repo','o/r']` mất token sau mỗi vòng sửa-lưu. Chèn thêm
 *     arg phía trước vẫn chặn được: khi đó `next[0]` là arg mới chứ 🚫 không
 *     phải `***`, và ô `***` trôi xuống `i > 0` rơi về neo cờ ở trên.
 *
 * Neo không khớp ⇒ BỎ HẲN phần tử. 🚫 Không ghi literal `***` xuống server con:
 * thiếu một tham số thì server báo lỗi rõ, còn `***` thì nó im lặng chạy sai.
 */
function restoreMaskedArgs(
  next?: string[],
  previous?: string[],
  warnings?: string[],
): string[] {
  const out: string[] = []
  const list = next ?? []
  const previousHits = new Set(collectSecretArgs(previous).map((hit) => hit.index))
  for (let i = 0; i < list.length; i++) {
    const arg = list[i]
    const inline = /^(--?[^=]+)=\*\*\*$/.exec(arg)

    if (arg === MCP_MASK) {
      const anchorOk = i > 0 ? previous?.[i - 1] === list[i - 1] : previousHits.has(0)
      if (anchorOk && previous?.[i] !== undefined) out.push(previous[i])
      else warnings?.push(MCP_WARN_ARGS_SECRET_DROPPED)
      continue
    }
    if (inline) {
      const prevArg = previous?.[i]
      if (prevArg?.startsWith(`${inline[1]}=`)) out.push(prevArg)
      else warnings?.push(MCP_WARN_ARGS_SECRET_DROPPED)
      continue
    }
    out.push(arg)
  }
  return out
}

/**
 * Thay mọi giá trị trong `secrets` bằng `***`. Dùng trước khi log / trả API.
 *
 * Thay theo thứ tự DÀI → NGẮN: nếu một secret là tiền tố của secret khác, thay
 * cái ngắn trước sẽ ăn mất phần đầu và để lộ phần đuôi — `abcdefgh` thay trước
 * biến `abcdefghXYZ` thành `***XYZ`. Sắp xếp giảm dần theo độ dài là đủ để
 * không ca nào che hụt ca nào.
 */
export function maskSecretText(text: string, secrets: readonly string[]): string {
  let out = text
  const ordered = [...new Set(secrets)].filter(Boolean).sort((a, b) => b.length - a.length)
  for (const secret of ordered) {
    out = out.split(secret).join(MCP_MASK)
  }
  return out
}

/** Bản sao đã thay giá trị `env`/`headers` bằng `***`; bản gốc giữ nguyên. */
export function maskSecretValues<T extends McpServerConfig>(server: T): T {
  if (isStdioServer(server)) {
    // `args === undefined` giữ nguyên `undefined` — xem chú thích ở `mergeMaskedSecrets`.
    return {
      ...server,
      env: maskRecord(server.env),
      ...(server.args === undefined ? {} : { args: maskArgs(server.args) }),
    } as T
  }
  return { ...server, headers: maskRecord(server.headers) } as T
}

function maskRecord(record: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(record || {})) {
    // `env:NAME` là tên biến, không phải giá trị — giữ để người dùng còn sửa được.
    out[k] = MCP_ENV_REF_PATTERN.test(v) ? v : MCP_MASK
  }
  return out
}

/** True khi giá trị gõ tay trông như secret literal (cảnh báo inline ở dialog). */
export function looksLikeSecretLiteral(key: string, value: string): boolean {
  if (MCP_ENV_REF_PATTERN.test(value)) return false
  if (value.length < SECRET_LIKE_MIN_LENGTH) return false
  return SECRET_LIKE_KEY.test(key)
}

/** Timeout hiệu lực: ưu tiên override, cắt trần `MCP_MAX_TIMEOUT_MS`. */
export function resolveTimeoutMs(...candidates: (number | undefined | null)[]): number {
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) {
      return Math.min(c, MCP_MAX_TIMEOUT_MS)
    }
  }
  return MCP_DEFAULT_TIMEOUT_MS
}
