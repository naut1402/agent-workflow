import {
  dirname,
  joinPath,
  mkdirSync,
  readTextFileSync,
  writeTextFileAtomicSync,
} from '../../../backend/lib/fileHelper.js'
import { registryHome } from '../../../backend/registry.js'
import {
  MCP_DEFAULT_TIMEOUT_MS,
  MCP_MAX_TOOL_NAMES,
  MCP_MAX_TOOL_NAME_LENGTH,
  MCP_SERVERS_VERSION,
  MCP_TRANSPORTS,
  type McpCheckSummary,
  type McpTransport,
} from '../schemas/mcpServer.js'
import { McpServer, type McpServerBaseFields } from './McpServer.js'
import { McpServerSet } from './McpServerSet.js'
import { RemoteMcpServer } from './RemoteMcpServer.js'
import { StdioMcpServer } from './StdioMcpServer.js'

export type McpMutationResult<T = {}> = ({ ok: true } & T) | { ok: false; status?: number; error: string }

interface McpServersStore {
  version: number
  servers: McpServer[]
}

function defaultServersFile(): string {
  return joinPath(registryHome(), 'mcp-servers.json')
}

function emptyStore(): McpServersStore {
  return { version: MCP_SERVERS_VERSION, servers: [] }
}

function toPositiveInt(raw: unknown): number | undefined {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.floor(n)
}

function normaliseCheckSummary(raw: any): McpCheckSummary | null {
  if (!raw || typeof raw !== 'object') return null
  const at = typeof raw.at === 'string' ? raw.at : ''
  if (!at) return null
  return {
    at,
    ok: raw.ok === true,
    toolCount: Number.isFinite(Number(raw.toolCount)) ? Math.max(0, Math.floor(Number(raw.toolCount))) : 0,
    toolNames: Array.isArray(raw.toolNames)
      ? raw.toolNames
          .filter((n: unknown): n is string => typeof n === 'string')
          .slice(0, MCP_MAX_TOOL_NAMES)
          .map((n: string) => n.slice(0, MCP_MAX_TOOL_NAME_LENGTH))
      : [],
    ...(typeof raw.error === 'string' && raw.error ? { error: raw.error } : {}),
  }
}

function normaliseBase(raw: any, id: string): McpServerBaseFields {
  const timeoutMs = toPositiveInt(raw.timeoutMs)
  return {
    id,
    label: String(raw.label || id).slice(0, 128),
    enabled: raw.enabled !== false,
    ...(timeoutMs ? { timeoutMs } : {}),
    lastCheck: normaliseCheckSummary(raw.lastCheck),
  }
}

/**
 * v1: `timeoutMs` chỉ tác động nút Kiểm tra kết nối. v2 ghi nó xuống
 * `startupTimeoutSec` của file config, nên nó tác động cả lúc job chạy server.
 *
 * Vì thế migrate bỏ trường ở MỌI bản ghi v1, không riêng mặc định cũ `15000`: người
 * đặt `30000` ở v1 đang chọn «probe chờ 30s», họ chưa từng chọn «job cho server 30s
 * để khởi động». Giữ lại là im lặng rút thời gian khởi động của job từ 120s xuống —
 * đúng lớp hồi quy hàm này sinh ra để chặn. Bỏ trường là trả về mặc định, không
 * phải mất dữ liệu.
 *
 * ⚠️ Điều kiện `< MCP_DEFAULT_TIMEOUT_MS` chứ 🚫 không xoá vô điều kiện: trần v1 là
 * 60s ở tầng endpoint (`schemas/mcpServer.ts` `.max()`), nhưng đường ĐỌC file không
 * kẹp gì (`toPositiveInt` chỉ làm tròn), nên file sửa tay vẫn có thể mang giá trị
 * vượt 120s. Giá trị như vậy chỉ làm job chờ LÂU hơn mặc định — không thuộc lớp lỗi
 * đang chặn, và xoá nó là vứt một con số người dùng cố ý ghi vào file.
 *
 * Ở v2 mọi giá trị đều là lựa chọn có chủ ý ⇒ chỉ bản ghi còn mang cờ v1 mới bị
 * đụng. Version thiếu/sai kiểu/`0` coi như v1: bỏ qua migrate ở đó là để lọt đúng
 * ca đang muốn chặn.
 *
 * Chạy ở đường đọc nên idempotent — file chỉ thật sự lên `version: 2` ở lần
 * ghi kế tiếp; dashboard chỉ đọc thì migrate lặp lại mỗi lần, vô hại.
 *
 * Sửa tại chỗ `config` của entity: entity ở đây vừa dựng từ đĩa trong cùng lượt
 * đọc, chưa ai khác giữ tham chiếu.
 */
function migrateToV2(servers: McpServer[], rawVersion: unknown): McpServer[] {
  const fileVersion = Number(rawVersion) || 1
  if (fileVersion >= MCP_SERVERS_VERSION) return servers
  for (const server of servers) {
    if (server.config.timeoutMs !== undefined && server.config.timeoutMs < MCP_DEFAULT_TIMEOUT_MS) {
      delete server.config.timeoutMs
    }
  }
  return servers
}

/**
 * Store `mcp-servers.json` của registry và chỗ lắp ráp DUY NHẤT biết hai hiện
 * thực `StdioMcpServer` / `RemoteMcpServer`: mọi bản ghi — đọc từ đĩa, form gửi
 * lên, entry dashboard tự gắn — thành entity qua `normalise`.
 */
export class McpRegistry {
  /** `file` — đường dẫn store, tính lại mỗi lần dùng (mặc định `registryHome()/mcp-servers.json`). */
  constructor(private readonly file: () => string = defaultServersFile) {}

  /** Record không hợp lệ bị bỏ im lặng — file registry là dữ liệu ngoài, không phải contract. */
  static normalise(raw: unknown): McpServer | null {
    const record = raw as any
    const id = McpServer.sanitiseId(record?.id)
    if (!id) return null
    const transport = String(record?.transport || '') as McpTransport
    if (!(MCP_TRANSPORTS as readonly string[]).includes(transport)) return null

    const base = normaliseBase(record, id)
    return transport === 'stdio'
      ? StdioMcpServer.normalise(record, base)
      : RemoteMcpServer.normalise(record, base, transport)
  }

  list(): McpServer[] {
    return this.load().servers
  }

  get(id: unknown): McpServer | null {
    const clean = McpServer.sanitiseId(id)
    if (!clean) return null
    return this.load().servers.find((s) => s.id === clean) || null
  }

  upsert(input: unknown): McpMutationResult<{ server: McpServer; warnings: string[] }> {
    const raw = input as any
    const id = McpServer.sanitiseId(raw?.id)
    if (!id) return { ok: false, status: 400, error: 'invalid mcp server id' }
    // `sanitiseId` là ánh xạ NHIỀU-MỘT (`my.server` và `my server` cùng
    // ra `myserver`). Ở đường đọc thì vô hại, nhưng upsert ghi đè theo id đã
    // chuẩn hoá: tạo mới `my.server` khi `myserver` đã tồn tại sẽ xoá sổ cấu hình
    // kia mà không báo gì. Chỉ nhận id đã ở dạng canonical — người dùng thấy lỗi
    // và tự sửa, thay vì mất dữ liệu trong im lặng.
    if (String(raw?.id ?? '').trim() !== id) {
      return { ok: false, status: 400, error: `invalid mcp server id — dùng dạng chuẩn "${id}"` }
    }
    const entry = McpRegistry.normalise({ ...raw, id })
    if (!entry) return { ok: false, status: 400, error: 'invalid mcp server config' }

    const store = this.load()
    const idx = store.servers.findIndex((s) => s.id === id)
    const previous = idx >= 0 ? store.servers[idx] : null
    // `lastCheck` là kết quả đo, không phải thứ form gửi lên — giữ lại bản cũ.
    // `***` ở env/headers cũng vậy: đó là bản mask client nhận từ API, không phải
    // giá trị người dùng vừa nhập.
    const warnings: string[] = []
    const merged = entry
      .restoreMasked(previous, warnings)
      .withLastCheck(entry.config.lastCheck ?? previous?.config.lastCheck ?? null)
    if (previous) store.servers[idx] = merged
    else store.servers.push(merged)
    this.save(store)
    return { ok: true, server: merged, warnings: [...new Set(warnings)] }
  }

  /**
   * DELETE idempotent: id lạ vẫn `ok` — người dùng đã đạt được trạng thái họ muốn.
   * Trả luôn `id` đã sanitise để caller dùng chung một giá trị cho audit, event và
   * response, thay vì lặp lại chuỗi thô từ query string.
   */
  delete(id: unknown): McpMutationResult<{ deleted: boolean; id: string }> {
    const clean = McpServer.sanitiseId(id)
    if (!clean) return { ok: false, status: 400, error: 'invalid id' }
    const store = this.load()
    const idx = store.servers.findIndex((s) => s.id === clean)
    if (idx < 0) return { ok: true, deleted: false, id: clean }
    store.servers.splice(idx, 1)
    this.save(store)
    return { ok: true, deleted: true, id: clean }
  }

  /** Bỏ qua im lặng khi id chưa có trong store — bản nháp chưa lưu vẫn test được. */
  recordCheck(id: unknown, summary: McpCheckSummary): void {
    const clean = McpServer.sanitiseId(id)
    if (!clean) return
    const store = this.load()
    const idx = store.servers.findIndex((s) => s.id === clean)
    if (idx < 0) return
    store.servers[idx] = store.servers[idx].withLastCheck(summary)
    this.save(store)
  }

  /**
   * Bộ server cho một job: lọc server đang bật theo `ids`, cảnh báo id rụng, rồi
   * nối `extras` (entry dashboard tự gắn) vào SAU. Chưa chạm đĩa một byte nào.
   *
   * Bất biến `null`: không `ids` VÀ không `extras` ⇒ `null`, nên mọi cách giao cùng
   * hưởng "không bật MCP ⇒ argv không đổi, không file nào chạm đĩa".
   *
   * `onWarning` nhận cảnh báo ngay khi phát sinh, kể cả khi hàm trả `null`. Id bị
   * tắt/xoá sau khi Connection đã chọn thì không còn bộ nào để mang `warnings` ra,
   * mà job chạy thiếu tool trong im lặng là thứ không ai truy ngược được.
   */
  select(input: {
    ids: unknown
    extras?: McpServer[]
    onWarning?: (message: string) => void
  }): McpServerSet | null {
    const ids = Array.isArray(input.ids) ? input.ids.filter((x): x is string => typeof x === 'string') : []
    const extras = input.extras ?? []
    // Bất biến: KHÔNG id nào VÀ không entry tự gắn nào ⇒ vẫn `null`, không file
    // nào chạm đĩa, argv CLI không đổi. Đây là đường mặc định của mọi job thường.
    if (!ids.length && !extras.length) return null

    const warnings: string[] = []
    const warn = (message: string) => {
      warnings.push(message)
      input.onWarning?.(message)
    }

    const servers = this.list().filter((s) => ids.includes(s.id) && s.enabled)
    const resolvedIds = new Set(servers.map((s) => s.id))
    for (const id of ids) {
      if (resolvedIds.has(id)) continue
      warn(`mcp ${id}: không tìm thấy hoặc đang tắt — job chạy không có server này`)
    }

    // Ghi đè im lặng là thứ không ai truy ngược được từ log job. So trên khoá ĐÃ
    // sanitise vì file dedup theo khoá đó: id `dev team dashboard` sanitise về
    // đúng `dev-team-dashboard` và bị ghi đè thật, so id thô sẽ bỏ sót.
    const extraKeys = new Set(extras.map((s) => s.key).filter(Boolean))
    for (const server of servers) {
      if (!extraKeys.has(server.key)) continue
      warn(`mcp ${server.id}: entry của người dùng bị entry tự gắn của dashboard ghi đè cho job điều phối`)
    }

    // Rụng hết thì vẫn `null` để giữ bất biến "không file nào chạm đĩa"; cảnh báo
    // đã đi ra qua `onWarning` ở trên nên không im lặng tuyệt đối.
    if (!servers.length && !extras.length) return null

    // `extras` sau `servers`: `toCliConfig` ghi theo thứ tự nên trùng khoá thì
    // entry tự gắn thắng.
    return new McpServerSet([...servers, ...extras], warnings)
  }

  private load(): McpServersStore {
    const file = this.file()
    let raw: string
    try {
      raw = readTextFileSync(file)
    } catch {
      return emptyStore()
    }
    try {
      const data = JSON.parse(raw.replace(/^\uFEFF/, ''))
      if (!data || !Array.isArray(data.servers)) return emptyStore()
      const servers = data.servers.map((s: unknown) => McpRegistry.normalise(s)).filter(Boolean) as McpServer[]
      return { version: MCP_SERVERS_VERSION, servers: migrateToV2(servers, data.version) }
    } catch {
      console.warn(`[dev-team-dashboard] mcp-servers.json corrupt: ${file}`)
      return emptyStore()
    }
  }

  /**
   * Ghi 0600: `env`/`headers` ở đây có thể là secret literal người dùng gõ tay
   * (dialog chỉ *cảnh báo* khi giá trị trông như secret, không chặn). Đây là chỗ
   * duy nhất trong repo persist secret dạng thô — `credentials.json` chỉ giữ ref,
   * giá trị thật nằm trong `secret-vault.json` đã mã hoá. Bản sao theo job của
   * đúng những secret này đã là 0600 (`mcpJobConfig.ts`), nên để bản gốc theo
   * umask (thường 0644, user khác trên máy đọc được) là lệch ngay trong một tính năng.
   *
   * 🚫 Không chmod `registryHome()`: thư mục đó dùng chung cho mọi feature, siết
   * quyền ở đó là quyết định ngoài phạm vi. Mode của chính file đã đủ chặn đọc.
   */
  private save(store: McpServersStore): void {
    const file = this.file()
    mkdirSync(dirname(file), { recursive: true })
    writeTextFileAtomicSync(file, JSON.stringify(
      { version: store.version || MCP_SERVERS_VERSION, servers: store.servers.map((s) => s.config) },
      null,
      2,
    ), { mode: 0o600 })
  }
}

/** Registry dùng chung của tiến trình — store ở `registryHome()/mcp-servers.json`. */
export const mcpRegistry = new McpRegistry()
