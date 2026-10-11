// xem docs/architecture/code/mcp.md §6

import { MCP_ENV_REF_PATTERN } from '../schemas/mcpServer.js'

const SECRET_LIKE_KEY = /authorization|token|key|secret|password/i
const SECRET_LIKE_MIN_LENGTH = 20

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
  /** Phát nốt phần còn giữ lại — gọi ở cả nhánh thành công lẫn nhánh lỗi. */
  flush(): string
}

export class SecretMasker {
  static readonly MASK = '***'

  /** Mã cảnh báo trả qua API — FE map sang i18n `mcp.warnings.*`. */
  static readonly WARN_ARGS_SECRET_LITERAL = 'args.secretLiteral'
  static readonly WARN_ARGS_SECRET_DROPPED = 'args.secretDropped'

  /** Masker rỗng — `mask` / `stream` trả nguyên văn, không buffer. */
  static readonly NONE: SecretMasker = new SecretMasker([])

  /** Chuỗi từ 8 ký tự, không phải `***` hay `env:NAME` — đủ điều kiện mask log. */
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
      if (arg === SecretMasker.MASK || arg.endsWith(`=${SecretMasker.MASK}`)) continue
      const inline = SECRET_ARG_INLINE.exec(arg)
      if (inline) {
        hits.push({ index: i, value: inline[2], flag: inline[1] })
        continue
      }
      const prev = i > 0 ? String(list[i - 1] ?? '') : ''
      if (SECRET_ARG_FLAG.test(prev) && !arg.startsWith('-')) {
        hits.push({ index: i, value: arg })
        continue
      }
      if (SECRET_VALUE_SHAPE.test(arg)) hits.push({ index: i, value: arg })
    }
    return hits
  }

  /** Bản `args` đã thay secret bằng `***` — không lọc theo `isMaskable`. */
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
      out[k] = MCP_ENV_REF_PATTERN.test(v) ? v : SecretMasker.MASK
    }
    return out
  }

  /** Secret theo thứ tự gặp lần đầu — đã bỏ trùng và bỏ chuỗi rỗng. */
  readonly values: readonly string[]

  private readonly ordered: readonly string[]

  /** Nhận gì che nấy — không lọc theo `isMaskable`. */
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

  /** Bản sao đã mask mọi chuỗi lồng trong `value`. */
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

  // xem docs/architecture/code/mcp.md §6
  /** Bộ lọc mask có trạng thái cho log stream — giữ đuôi chưa chắc an toàn tới chunk sau hoặc `flush()`. */
  stream(): SecretStream {
    const list = this.values
    const hasSecret = list.length > 0
    const keep = hasSecret ? Math.max(...list.map((s) => s.length)) - 1 : 0
    let pending = ''

    return {
      push: (chunk) => {
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
