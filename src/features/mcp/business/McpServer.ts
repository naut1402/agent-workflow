import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  MCP_DEFAULT_TIMEOUT_MS,
  MCP_ENV_REF_PATTERN,
  MCP_MAX_TIMEOUT_MS,
  type McpCheckSummary,
  type McpServerConfig,
  type McpTransport,
} from '../schemas/mcpServer.js'
import type { CredentialResolver } from './CredentialResolver.js'
import { SecretMasker } from './SecretMasker.js'

/** Phần chung của mọi transport — `normalise` của từng hiện thực spread lên trên. */
export interface McpServerBaseFields {
  id: string
  label: string
  enabled: boolean
  timeoutMs?: number
  lastCheck: McpCheckSummary | null
}

export interface McpResolveContext {
  /** Do caller tiêm — `mcp` không được biết credential store. */
  credentials?: CredentialResolver | null
}

/** `env` (stdio) hoặc `headers` (remote) sau khi giải `env:NAME` và credential. */
export interface ResolvedMcpServer {
  /** Giá trị THẬT — chỉ đi vào transport / file config, 🚫 không bao giờ ra log. */
  values: Record<string, string>
  /** Secret giải từ credential profile; `null` khi không khai hoặc không giải được. */
  secret: string | null
  warnings: string[]
}

export interface McpCliContext extends McpResolveContext {
  /** cwd của job — dùng để cảnh báo khi server khai `cwd` khác. */
  workspace: string
}

/** Một entry `mcpServers` của file cấu hình CLI. */
export interface McpCliEntry {
  entry: Record<string, unknown>
  /** Giá trị cần mask log — cả giá trị gõ tay lẫn giá trị đã giải. */
  secrets: string[]
  /** Đã gắn tiền tố `<id>: `. */
  warnings: string[]
}

export interface McpTransportOptions extends McpResolveContext {
  /** cwd mặc định cho server stdio khi bản thân server không khai. */
  cwd?: string
}

export interface McpTransportPlan {
  transport: Transport
  secrets: string[]
  warnings: string[]
}

/**
 * Một MCP server người dùng khai (hoặc dashboard tự gắn). Mỗi transport là một
 * hiện thực — `StdioMcpServer`, `RemoteMcpServer` — và CHỈ `McpRegistry.normalise`
 * biết chọn lớp nào: caller khác chỉ làm việc với lớp này.
 *
 * Bất biến: `config` là bản ghi đã chuẩn hoá; mọi phép biến đổi (`restoreMasked`,
 * `withLastCheck`) trả bản MỚI.
 */
export abstract class McpServer<C extends McpServerConfig = McpServerConfig> {
  protected constructor(readonly config: C) {}

  get id(): string {
    return this.config.id
  }

  get label(): string {
    return this.config.label
  }

  get enabled(): boolean {
    return this.config.enabled
  }

  get transport(): McpTransport {
    return this.config.transport
  }

  /** Khoá entry trong file cấu hình CLI và tiền tố tên tool — `null` ⇒ id không dùng được. */
  get key(): string | null {
    return McpServer.sanitiseId(this.config.id)
  }

  /** Cùng luật với `sanitiseRunnerId` — bản sao cố ý, để `mcp` không phụ thuộc `runner`. */
  static sanitiseId(id: unknown): string | null {
    if (typeof id !== 'string' || !id.trim()) return null
    if (/[\\/\0]/.test(id)) return null
    const clean = id.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
    return clean || null
  }

  /** Timeout hiệu lực: ưu tiên override, cắt trần `MCP_MAX_TIMEOUT_MS`. */
  static resolveTimeoutMs(...candidates: (number | undefined | null)[]): number {
    for (const c of candidates) {
      if (typeof c === 'number' && Number.isFinite(c) && c > 0) {
        return Math.min(c, MCP_MAX_TIMEOUT_MS)
      }
    }
    return MCP_DEFAULT_TIMEOUT_MS
  }

  /** Timeout hiệu lực của server này; `override` (nếu có) thắng giá trị đã lưu. */
  timeoutMs(override?: number): number {
    return McpServer.resolveTimeoutMs(override, this.config.timeoutMs)
  }

  withLastCheck(summary: McpCheckSummary | null): McpServer<C> {
    return this.rebuild({ ...this.config, lastCheck: summary })
  }

  /** Dựng bản mới CÙNG lớp từ một bản ghi — để biến đổi không làm đổi hiện thực. */
  protected abstract rebuild(config: C): McpServer<C>

  /** Bản sao đã thay giá trị secret bằng `***`; bản gốc giữ nguyên. */
  abstract masked(): C

  /**
   * Gộp bản gửi lên với bản đang lưu: API trả cấu hình đã mask, nên client gửi
   * ngược lại đúng `***` ở mọi khoá nó không sửa. Coi `***` là sentinel "giữ
   * nguyên" — nếu không, một cú bấm bật/tắt là ghi đè secret thật bằng `***`.
   *
   * Khoá mang `***` mà bản cũ không có thì bỏ hẳn: không có gì để khôi phục, và
   * ghi literal `***` xuống server con còn tệ hơn thiếu khoá.
   *
   * `warnings` — sink tuỳ chọn: nhận mã cảnh báo khi một ô `***` bị bỏ vì neo không khớp.
   */
  abstract restoreMasked(previous: McpServer | null, warnings?: string[]): McpServer<C>

  /**
   * Giá trị do người dùng gõ tay có thể là secret literal — gom để mask log/API.
   * Bỏ `env:NAME` (tên biến, không phải giá trị) và `***` (đã mask rồi): mask
   * chúng chỉ làm log khó đọc mà không che thêm gì.
   */
  abstract secretValues(): string[]

  /**
   * Đích thật mà probe sẽ nói chuyện. Dùng để so bản nháp với bản đã lưu: cùng
   * `id` là chưa đủ, vì `id` do người gửi đặt còn secret thì lấy từ bản đã lưu.
   *
   * 📌 So trên giá trị THÔ, 🚫 không mask. Mask hai vế thì mọi arg đứng sau một cờ
   * mang tên secret (`--auth`, `--token`, …) đều thành `***` ở cả hai bên, nên đổi
   * GIÁ TRỊ của nó không còn làm đích khác đi — tức nới đúng cái cổng này ra.
   * Ca cụ thể: đã lưu `--auth https://internal --token sk-REAL`, gửi lên
   * `--auth https://attacker --token ***` ⇒ mask hai vế cho kết quả bằng nhau ⇒
   * khôi phục `sk-REAL` rồi probe tới host của người gửi.
   *
   * Vấn đề "bản nháp mang `***` nên không bao giờ khớp" (E3) được xử lý ở CHỖ GỌI,
   * bằng cách so bản ĐÃ KHÔI PHỤC thay vì bản thô — xem `McpController.testServer`.
   */
  abstract destination(): string

  /** Bản nháp có ô nào đang là `***`, tức đang trông chờ khôi phục từ bản đã lưu. */
  abstract needsStoredSecret(): boolean

  /**
   * Mã cảnh báo cấu hình (`SecretMasker.WARN_*`) — 🚫 KHÔNG chặn lưu. Mặc định
   * không có gì để cảnh báo.
   */
  warnings(): string[] {
    return []
  }

  /** Ném `Error` khi đích kết nối không được phép. Mặc định không có đích mạng nào để kiểm. */
  assertEndpoint(): void {}

  /** Giải `env:NAME` và credential — 🚫 không ném; thiếu gì thì bỏ khoá kèm cảnh báo. */
  abstract resolve(ctx?: McpResolveContext): ResolvedMcpServer

  /** Một entry `mcpServers` cho file cấu hình CLI (`--mcp-config`, `.cursor/mcp.json`). */
  abstract toCliEntry(ctx: McpCliContext): McpCliEntry

  /** Transport SDK để `McpClient` kết nối, kèm danh sách mask cho thông điệp lỗi. */
  abstract createTransport(opts?: McpTransportOptions): McpTransportPlan

  /**
   * `env:NAME` → `process.env.NAME`. Biến không tồn tại thì BỎ HẲN khoá đó: ghi
   * literal `env:NAME` xuống server con còn tệ hơn thiếu biến, vì nó trông như
   * một token hợp lệ.
   */
  protected static resolveEnvRefs(record?: Record<string, string>): {
    values: Record<string, string>
    warnings: string[]
  } {
    const out: Record<string, string> = {}
    const warnings: string[] = []
    for (const [key, raw] of Object.entries(record || {})) {
      const match = MCP_ENV_REF_PATTERN.exec(raw)
      if (!match) {
        out[key] = raw
        continue
      }
      const value = process.env[match[1]]
      if (value == null || value === '') {
        warnings.push(`env ${key}: biến môi trường ${match[1]} chưa đặt — bỏ qua khoá này`)
        continue
      }
      out[key] = value
    }
    return { values: out, warnings }
  }

  /** Bản `env`/`headers` đã khôi phục `***` từ bản cũ — xem `restoreMasked`. */
  protected static restoreMaskedRecord(
    next: Record<string, string> | undefined,
    previous: Record<string, string>,
  ): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(next || {})) {
      if (v !== SecretMasker.MASK) {
        out[k] = v
        continue
      }
      if (previous[k] !== undefined) out[k] = previous[k]
    }
    return out
  }

  /** Record chuỗi→chuỗi từ dữ liệu ngoài: bỏ khoá rỗng và giá trị không phải chuỗi. */
  protected static toStringRecord(raw: unknown): Record<string, string> {
    const out: Record<string, string> = {}
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!k.trim()) continue
      if (typeof v !== 'string') continue
      out[k] = v
    }
    return out
  }

  protected static prefix(id: string, messages: string[]): string[] {
    return messages.map((m) => `${id}: ${m}`)
  }
}
