// Value object che secret trước khi một chuỗi rời tiến trình (log job, response
// API, kết quả tool). Node-free: FE import thẳng file này (`components/*.vue`)
// để dialog dùng CHÍNH quy tắc nhận diện secret của backend — 🚫 không import
// `node:*` hay SDK MCP ở đây.

import { MCP_ENV_REF_PATTERN } from '../schemas/mcpServer.js'

/** Key trông như secret + đủ dài ⇒ dialog cảnh báo nên dùng credential profile. */
const SECRET_LIKE_KEY = /authorization|token|key|secret|password/i
const SECRET_LIKE_MIN_LENGTH = 20

/**
 * Nhận diện secret trong `stdio.args`. 🚫 KHÔNG dùng `isMaskable` ở đây:
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

/** Bộ lọc mask CÓ TRẠNG THÁI cho log dạng stream — xem `SecretMasker.stream`. */
export interface SecretStream {
  /** Nuốt một chunk, trả phần đã chắc chắn an toàn để phát ra ngoài. */
  push(chunk: string): string
  /** Phát nốt phần còn giữ lại. Bắt buộc gọi ở CẢ nhánh thành công lẫn nhánh lỗi. */
  flush(): string
}

export class SecretMasker {
  static readonly MASK = '***'

  /**
   * Mã cảnh báo trả qua API. FE map sang i18n (`mcp.warnings.*`) — 🚫 không trả
   * chuỗi đã dịch từ backend: backend không biết người dùng đang xem ngôn ngữ nào.
   */
  static readonly WARN_ARGS_SECRET_LITERAL = 'args.secretLiteral'
  static readonly WARN_ARGS_SECRET_DROPPED = 'args.secretDropped'

  /** Masker rỗng — `mask` / `stream` trả nguyên văn, không buffer. */
  static readonly NONE: SecretMasker = new SecretMasker([])

  /** Ngưỡng 8 ký tự: chuỗi ngắn hơn trùng ngẫu nhiên với text thường, mask vào là hỏng log. */
  static isMaskable(value: unknown): value is string {
    if (typeof value !== 'string' || value.length < 8) return false
    if (value === SecretMasker.MASK) return false
    return !MCP_ENV_REF_PATTERN.test(value)
  }

  /** True khi giá trị gõ tay trông như secret literal (cảnh báo inline ở dialog). */
  static looksLikeSecretLiteral(key: string, value: string): boolean {
    if (MCP_ENV_REF_PATTERN.test(value)) return false
    if (value.length < SECRET_LIKE_MIN_LENGTH) return false
    return SECRET_LIKE_KEY.test(key)
  }

  static secretArgs(args?: readonly string[]): SecretArgHit[] {
    const hits: SecretArgHit[] = []
    const list = args ?? []
    for (let i = 0; i < list.length; i++) {
      const arg = list[i]
      if (typeof arg !== 'string') continue
      // Bản thân sentinel không phải secret — không thì mọi vòng round-trip
      // (`lấy về đã mask → bấm Lưu`) đều báo động giả.
      if (arg === SecretMasker.MASK || arg.endsWith(`=${SecretMasker.MASK}`)) continue
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
   * Bản `args` đã thay secret bằng `***`. 🚫 Không lọc `isMaskable` ở đây:
   * với API thì thà che hụt độ dài còn hơn để lộ.
   */
  static maskArgs(args?: readonly string[]): string[] {
    const list = [...(args ?? [])]
    for (const hit of SecretMasker.secretArgs(list)) {
      list[hit.index] = hit.flag ? `${hit.flag}=${SecretMasker.MASK}` : SecretMasker.MASK
    }
    return list
  }

  /** Bản sao đã thay mọi giá trị bằng `***`, trừ tham chiếu `env:NAME`. */
  static maskRecord(record?: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(record || {})) {
      // `env:NAME` là tên biến, không phải giá trị — giữ để người dùng còn sửa được.
      out[k] = MCP_ENV_REF_PATTERN.test(v) ? v : SecretMasker.MASK
    }
    return out
  }

  /** Secret theo thứ tự gặp lần đầu — đã bỏ trùng và bỏ chuỗi rỗng. */
  readonly values: readonly string[]

  /**
   * Thứ tự DÀI → NGẮN cho `mask`: nếu một secret là tiền tố của secret khác, thay
   * cái ngắn trước sẽ ăn mất phần đầu và để lộ phần đuôi — `abcdefgh` thay trước
   * biến `abcdefghXYZ` thành `***XYZ`. Sắp xếp giảm dần theo độ dài là đủ để
   * không ca nào che hụt ca nào.
   */
  private readonly ordered: readonly string[]

  /**
   * 🚫 Không lọc `isMaskable` ở đây — hai ngưỡng lọc khác nhau là có chủ ý: danh
   * sách mask LOG lọc ở chỗ dựng (`McpServer.secretValues`, …), còn masker nhận
   * gì che nấy.
   */
  constructor(secrets: readonly string[]) {
    this.values = [...new Set(secrets)].filter(Boolean)
    this.ordered = [...this.values].sort((a, b) => b.length - a.length)
  }

  /** Bản mới gộp thêm secret — bản hiện tại giữ nguyên. */
  with(...more: readonly (readonly string[])[]): SecretMasker {
    return new SecretMasker([...this.values, ...more.flat()])
  }

  /** Thay mọi secret trong `text` bằng `***`. Dùng trước khi log / trả API. */
  mask(text: string): string {
    let out = text
    for (const secret of this.ordered) {
      out = out.split(secret).join(SecretMasker.MASK)
    }
    return out
  }

  /**
   * Kết quả tool đi thẳng vào log job và vào `messages` được persist, nên secret
   * phải bị thay TRƯỚC khi nó rời tiến trình — ràng buộc này áp cho cả họ `ai-api`,
   * không riêng `agent-cli` (ở đó `maskLog` lo phần tương ứng).
   */
  maskDeep(value: unknown): unknown {
    if (!this.values.length) return value
    if (typeof value === 'string') return this.mask(value)
    if (Array.isArray(value)) return value.map((v) => this.maskDeep(v))
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = this.maskDeep(v)
      return out
    }
    return value
  }

  /**
   * Vì sao cần trạng thái: `mask` là split/join không trạng thái, nên một secret
   * bị tiến trình con xuất làm hai chunk (`"sk-test-LEAK"` + `"CANARY"`) lọt qua cả
   * hai lần gọi — mỗi nửa không khớp chuỗi nào nên không bị thay.
   *
   * Cách chữa: giữ ít nhất `max(len(secret)) - 1` ký tự RAW ở cuối buffer.
   * Nếu điểm cắt nằm trong secret hoàn chỉnh, lùi về đầu secret trước khi mask
   * và phát phần đầu. `pending` chưa mask để chunk sau còn nhận diện secret dài hơn.
   *
   * ⚠️ Đánh đổi thật, không phải refactor thuần: log stream TRỄ phần đuôi
   * cho tới chunk sau hoặc `flush()`. Không flush ở nhánh lỗi là nuốt mất
   * đuôi log — đúng đoạn người dùng cần để biết job hỏng vì sao.
   *
   * Đặt ở `mcp/business/` chứ không ở `runner/business/providers/`: `maskLog` hiện
   * chỉ phủ `createLocalConsoleProvider`, họ `ai-api` không đi qua đó. Để ở đây thì
   * cả hai họ provider dùng chung được một bản.
   */
  stream(): SecretStream {
    const list = this.values
    // 📌 Hai điều kiện tách hẳn nhau. `keep === 0` có thể nghĩa là "không có
    // secret" HOẶC "secret dài nhất đúng 1 ký tự" — gộp chúng thì ca thứ hai trả
    // chunk CHƯA MASK. Hôm nay bất khả (mọi caller lọc qua `isMaskable`,
    // ≥ 8 ký tự) nhưng đó là một cửa sập: bỏ bộ lọc ở caller là mất mask mà
    // 🚫 không test nào đỏ.
    const hasSecret = list.length > 0
    const keep = hasSecret ? Math.max(...list.map((s) => s.length)) - 1 : 0
    let pending = ''

    return {
      push: (chunk) => {
        // Không secret nào ⇒ đường cũ y nguyên: không buffer, không trễ một ký tự.
        if (!hasSecret) return chunk
        const buffer = pending + chunk
        let cut = Math.max(0, buffer.length - keep)
        for (let i = cut - 1; i >= 0; i--) {
          if (list.some((secret) => i + secret.length > cut && buffer.startsWith(secret, i))) {
            cut = i
          }
        }
        pending = buffer.slice(cut)
        return this.mask(buffer.slice(0, cut))
      },
      flush: () => {
        const out = this.mask(pending)
        pending = ''
        return out
      },
    }
  }
}
