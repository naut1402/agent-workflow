import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { MCP_MAX_TIMEOUT_MS, MCP_MIN_TIMEOUT_MS, type McpStdioServer } from '../schemas/mcpServer.js'
import {
  McpServer,
  type McpCliContext,
  type McpCliEntry,
  type McpResolveContext,
  type McpServerBaseFields,
  type McpTransportOptions,
  type McpTransportPlan,
  type ResolvedMcpServer,
} from './McpServer.js'
import { SecretMasker } from './SecretMasker.js'

/** Miền của `startupTimeoutSec` (giây) — cùng nguồn với trần/sàn của ô Timeout. */
const STARTUP_TIMEOUT_MIN_SEC = MCP_MIN_TIMEOUT_MS / 1000
const STARTUP_TIMEOUT_MAX_SEC = MCP_MAX_TIMEOUT_MS / 1000

/** MCP server chạy như tiến trình con, nói chuyện qua stdin/stdout. */
export class StdioMcpServer extends McpServer<McpStdioServer> {
  constructor(config: McpStdioServer) {
    super(config)
  }

  /**
   * 📌 Guard `command` rỗng ⇒ `null` PHẢI nằm ở đây, 🚫 không được nâng lên hàm
   * cha. Nâng lên là đổi THỨ TỰ kiểm tra, tức đổi cái gì được coi là cấu hình hợp
   * lệ — và hàm này là cổng bảo mật: mọi bản ghi đọc từ đĩa đi qua nó.
   */
  static normalise(raw: any, base: McpServerBaseFields): StdioMcpServer | null {
    const command = String(raw.command || '').trim()
    if (!command) return null
    return new StdioMcpServer({
      ...base,
      transport: 'stdio',
      command,
      args: Array.isArray(raw.args) ? raw.args.filter((a: unknown): a is string => typeof a === 'string') : [],
      env: McpServer.toStringRecord(raw.env),
      ...(typeof raw.cwd === 'string' && raw.cwd.trim() ? { cwd: raw.cwd.trim() } : {}),
    })
  }

  protected rebuild(config: McpStdioServer): StdioMcpServer {
    return new StdioMcpServer(config)
  }

  masked(): McpStdioServer {
    const server = this.config
    // `args === undefined` giữ nguyên `undefined` — xem chú thích ở `restoreMasked`.
    return {
      ...server,
      env: SecretMasker.maskRecord(server.env),
      ...(server.args === undefined ? {} : { args: SecretMasker.maskArgs(server.args) }),
    }
  }

  restoreMasked(previous: McpServer | null, warnings?: string[]): StdioMcpServer {
    const next = this.config
    const prevStdio = previous && previous.config.transport === 'stdio' ? previous.config : null
    return new StdioMcpServer({
      ...next,
      env: McpServer.restoreMaskedRecord(next.env, prevStdio?.env ?? {}),
      // `undefined` phải ở nguyên `undefined`: hoá nó thành `[]` là làm hỏng bất
      // biến round-trip `restoreMasked(masked(s), s) === s`.
      ...(next.args === undefined
        ? {}
        : { args: restoreMaskedArgs(next.args, prevStdio?.args, warnings) }),
    })
  }

  secretValues(): string[] {
    const server = this.config
    const values = Object.values(server.env || {}).filter(SecretMasker.isMaskable)
    // Lọc `isMaskable` ở cả `args`: danh sách trả về dùng để THAY CHUỖI trong log,
    // mà thay một chuỗi < 8 ký tự là làm log không đọc được nữa.
    // `SecretMasker.maskArgs` (đường API) thì ngược lại — không lọc, xem chú thích ở đó.
    return [
      ...values,
      ...SecretMasker.secretArgs(server.args)
        .map((hit) => hit.value)
        .filter(SecretMasker.isMaskable),
    ]
  }

  destination(): string {
    return `stdio ${this.config.command} ${JSON.stringify(this.config.args ?? [])}`
  }

  needsStoredSecret(): boolean {
    const server = this.config
    if (Object.values(server.env || {}).some((v) => v === SecretMasker.MASK)) return true
    // `args` mang hai dạng mask: ô trọn vẹn `***` và dạng gộp `--token=***`.
    return (server.args ?? []).some((a) => a === SecretMasker.MASK || a.endsWith(`=${SecretMasker.MASK}`))
  }

  /**
   * Cảnh báo cấu hình — 🚫 KHÔNG chặn.
   *
   * Vì sao không phải `.superRefine` trên schema: mọi issue Zod thêm vào đều làm
   * `safeParse` trả `success: false`, tức biến cảnh báo thành 400. Mà literal secret
   * trong `args` là thứ ĐÃ nằm trong cấu hình người dùng đang chạy — chặn ở đó nghĩa
   * là một server đang chạy bỗng không bấm Lưu lại được nữa. Đó là một bước migrate,
   * không phải một bản vá (design §3.3). Nên: cảnh báo đi kèm response 2xx và người
   * dùng tự quyết có chuyển sang credential profile không.
   */
  warnings(): string[] {
    return SecretMasker.secretArgs(this.config.args).length ? [SecretMasker.WARN_ARGS_SECRET_LITERAL] : []
  }

  resolve(_ctx?: McpResolveContext): ResolvedMcpServer {
    const { values, warnings } = McpServer.resolveEnvRefs(this.config.env)
    return { values, secret: null, warnings }
  }

  /**
   * `startupTimeoutSec` chỉ ghi cho entry stdio: schema của CLI gắn khoá đó sau
   * predicate `transport === 'stdio'`, còn entry remote không spawn tiến trình nào.
   */
  toCliEntry(ctx: McpCliContext): McpCliEntry {
    const server = this.config
    // Cả giá trị gõ tay lẫn giá trị đã giải từ `env:NAME` đều có thể là secret và
    // đều đi vào file config, nên cả hai phải nằm trong danh sách mask log.
    const secrets = this.secretValues()
    const warnings: string[] = []

    const resolved = this.resolve(ctx)
    warnings.push(...McpServer.prefix(server.id, resolved.warnings))
    secrets.push(...Object.values(resolved.values).filter(SecretMasker.isMaskable))
    if (server.cwd && server.cwd !== ctx.workspace) {
      warnings.push(
        `${server.id}: cấu hình MCP của CLI không có khoá cwd — server sẽ chạy tại ${ctx.workspace}`,
      )
    }
    const startupTimeoutSec = toStartupTimeoutSec(server.timeoutMs)
    if (startupTimeoutSec !== null) {
      warnings.push(...McpServer.prefix(server.id, timeoutWarnings(server.timeoutMs!, startupTimeoutSec)))
    }
    return {
      entry: {
        type: 'stdio',
        command: server.command,
        args: server.args ?? [],
        env: resolved.values,
        // Khai thiếu khoá ⇒ CLI dùng mặc định 120s của nó; ghi `null` thì entry bị
        // từ chối. Nên server không khai timeout thì entry giữ đúng bốn khoá như cũ.
        ...(startupTimeoutSec === null ? {} : { startupTimeoutSec }),
      },
      secrets,
      warnings,
    }
  }

  createTransport(opts: McpTransportOptions = {}): McpTransportPlan {
    const server = this.config
    const resolved = this.resolve(opts)
    const hostEnv = fullProcessEnv()
    return {
      transport: new StdioClientTransport({
        command: server.command,
        args: server.args ?? [],
        // `server.env` spread sau nên thắng khi trùng khoá — giữ đúng hành vi cũ và
        // khớp cách CLI dựng env cho server con.
        env: { ...hostEnv, ...resolved.values },
        cwd: server.cwd || opts.cwd || process.cwd(),
        stderr: 'pipe',
      }),
      secrets: [
        // Giá trị người dùng khai trong dialog: ngưỡng `isMaskable` (chỉ theo
        // độ dài) vì mọi giá trị ở đây đều do người dùng gõ cho server này.
        ...Object.values(resolved.values).filter(SecretMasker.isMaskable),
        // Giá trị của HOST: từ khi probe bơm full `process.env` xuống tiến trình con,
        // `ANTHROPIC_API_KEY`/`DASHBOARD_SECRET_KEY` nằm trong tầm với của server con —
        // nó vọng lại một giá trị nào đó vào thông điệp lỗi là chuỗi đó ra thẳng dialog
        // và bị persist vào `lastCheck.error` (`McpRegistry.recordCheck`). Trước đây con
        // chỉ nhận 6 biến nên không có gì để vọng; giờ có, nên danh sách mask phải phủ theo.
        //
        // Lọc theo TÊN KHOÁ (`looksLikeSecretLiteral`) chứ 🚫 không theo `isMaskable`:
        // ngưỡng độ dài đơn thuần nuốt cả `PATH`/`HOME`/`PWD` — đúng thứ duy nhất người
        // dùng có để sửa cấu hình.
        ...Object.entries(hostEnv)
          .filter(([key, value]) => SecretMasker.looksLikeSecretLiteral(key, value))
          .map(([, value]) => value),
      ],
      warnings: resolved.warnings,
    }
  }
}

/**
 * Bản cho `args`: khác `env`/`headers` ở chỗ không có khoá để ghép, chỉ có vị
 * trí. Vị trí một mình thì không đủ — người dùng chèn/xoá một arg phía trước là
 * mọi ô sau lệch đi một, và khôi phục theo vị trí lệch nghĩa là ghi secret của
 * tham số này vào tham số khác.
 *
 * Nên mỗi dạng mask phải có một NEO chứng minh hai mảng đang nói về cùng tham số:
 *   - dạng gộp `--flag=***` ⇒ `previous[i]` phải bắt đầu bằng đúng `\`${flag}=\``
 *   - dạng vị trí `***`     ⇒ `maskArgs(previous)[i - 1]` phải trùng `next[i - 1]`
 *     và bản cũ phải có secret ở đúng vị trí `i`
 *   - dạng vị trí ở `i === 0` ⇒ không có cờ nào đứng trước để neo, nên neo bằng
 *     "bản cũ CŨNG đang giữ secret ở đúng ô 0". `secretArgs` nhận secret
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
  const previousHits = new Set(SecretMasker.secretArgs(previous).map((hit) => hit.index))
  const maskedPrevious = SecretMasker.maskArgs(previous)
  for (let i = 0; i < list.length; i++) {
    const arg = list[i]
    const inline = /^(--?[^=]+)=\*\*\*$/.exec(arg)

    if (arg === SecretMasker.MASK) {
      const anchorOk = i === 0 || maskedPrevious[i - 1] === list[i - 1]
      if (anchorOk && previousHits.has(i) && previous?.[i] !== undefined) out.push(previous[i])
      else warnings?.push(SecretMasker.WARN_ARGS_SECRET_DROPPED)
      continue
    }
    if (inline) {
      const prevArg = previous?.[i]
      if (prevArg?.startsWith(`${inline[1]}=`)) out.push(prevArg)
      else warnings?.push(SecretMasker.WARN_ARGS_SECRET_DROPPED)
      continue
    }
    out.push(arg)
  }
  return out
}

/**
 * Full `process.env` chứ 🚫 KHÔNG `getDefaultEnvironment()` (6 biến): job thật spawn
 * `claude` với `{...process.env}` và Claude Code truyền nguyên env đó xuống MCP
 * server. Probe hẹp hơn là probe một cấu hình KHÁC cấu hình sẽ chạy — đúng bug
 * «kiểm tra fail nhưng agent vẫn lấy được tool» người dùng báo.
 *
 * Lọc giá trị không phải chuỗi: `process.env` có thể mang `undefined` ở khoá đã
 * xoá, mà `StdioClientTransport` cần `Record<string, string>`.
 */
function fullProcessEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}

/**
 * `startupTimeoutSec` của CLI là **số nguyên giây** trong miền [5, 600]; entry mang
 * giá trị ngoài miền bị CLI từ chối, nên kẹp ở đây thay vì đẩy file hỏng xuống.
 *
 * `null` = 🚫 không khai khoá ⇒ CLI dùng mặc định 120s của nó. Đây là thứ giữ cho
 * việc nâng mặc định của dashboard không rò rỉ vào file config.
 *
 * 🚫 Chỉ gọi cho entry stdio: schema CLI chỉ nhận khoá này khi `transport === 'stdio'`
 * (đã đọc lại trên bản 2.1.267), và shape entry remote là contract của bên thứ ba.
 */
function toStartupTimeoutSec(timeoutMs: number | undefined): number | null {
  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return null
  const sec = Math.round(timeoutMs / 1000)
  return Math.min(STARTUP_TIMEOUT_MAX_SEC, Math.max(STARTUP_TIMEOUT_MIN_SEC, sec))
}

/**
 * Hai nguyên nhân khác nhau ⇒ hai thông điệp khác nhau. Nói «ngoài miền [5s, 600s]»
 * cho 7500ms là sai: 7,5s nằm TRONG miền, thứ xảy ra chỉ là làm tròn về giây.
 * Miền được kiểm trên giá trị ms gốc, không trên giá trị đã làm tròn — 4999ms là
 * dưới sàn thật, không phải ca làm tròn.
 */
function timeoutWarnings(timeoutMs: number, startupTimeoutSec: number): string[] {
  if (timeoutMs < MCP_MIN_TIMEOUT_MS || timeoutMs > MCP_MAX_TIMEOUT_MS) {
    return [
      `timeout ${timeoutMs}ms nằm ngoài miền [${STARTUP_TIMEOUT_MIN_SEC}s, ${STARTUP_TIMEOUT_MAX_SEC}s] của CLI — job dùng ${startupTimeoutSec}s`,
    ]
  }
  if (timeoutMs !== startupTimeoutSec * 1000) {
    return [
      `timeout ${timeoutMs}ms được làm tròn thành ${startupTimeoutSec}s — CLI chỉ nhận số nguyên giây`,
    ]
  }
  return []
}
