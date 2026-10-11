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

// xem docs/architecture/code/mcp.md §2
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

/** Store `mcp-servers.json` và chỗ lắp ráp duy nhất biết hai hiện thực `StdioMcpServer` / `RemoteMcpServer`. */
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
    // xem docs/mcp/client.md §8
    if (String(raw?.id ?? '').trim() !== id) {
      return { ok: false, status: 400, error: `invalid mcp server id — dùng dạng chuẩn "${id}"` }
    }
    const entry = McpRegistry.normalise({ ...raw, id })
    if (!entry) return { ok: false, status: 400, error: 'invalid mcp server config' }

    const store = this.load()
    const idx = store.servers.findIndex((s) => s.id === id)
    const previous = idx >= 0 ? store.servers[idx] : null
    // xem docs/mcp/client.md §5
    const warnings: string[] = []
    const merged = entry
      .restoreMasked(previous, warnings)
      .withLastCheck(entry.config.lastCheck ?? previous?.config.lastCheck ?? null)
    if (previous) store.servers[idx] = merged
    else store.servers.push(merged)
    this.save(store)
    return { ok: true, server: merged, warnings: [...new Set(warnings)] }
  }

  /** Xoá idempotent — id lạ vẫn `ok`; trả `id` đã sanitise. */
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

  /** Bộ server cho một job: server đang bật theo `ids` rồi tới `extras`; `null` khi không còn server nào, kể cả lúc đó `onWarning` vẫn nhận cảnh báo. */
  select(input: {
    ids: unknown
    extras?: McpServer[]
    onWarning?: (message: string) => void
  }): McpServerSet | null {
    const ids = Array.isArray(input.ids) ? input.ids.filter((x): x is string => typeof x === 'string') : []
    const extras = input.extras ?? []
    // xem docs/mcp/client.md §7
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

    // xem docs/architecture/code/mcp.md §2
    const extraKeys = new Set(extras.map((s) => s.key).filter(Boolean))
    for (const server of servers) {
      if (!extraKeys.has(server.key)) continue
      warn(`mcp ${server.id}: entry của người dùng bị entry tự gắn của dashboard ghi đè cho job điều phối`)
    }

    if (!servers.length && !extras.length) return null

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

  // xem docs/mcp/client.md §2
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
