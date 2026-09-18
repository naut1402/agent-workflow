import { joinPath, mkdirSync, readTextFileSync, writeTextFileAtomicSync } from '../../../backend/lib/fileHelper.js'
import { registryHome } from '../../../backend/registry.js'
import {
  MCP_MAX_TOOL_NAMES,
  MCP_MAX_TOOL_NAME_LENGTH,
  MCP_SERVERS_VERSION,
  MCP_TRANSPORTS,
  mergeMaskedSecrets,
  sanitiseMcpServerId,
  type McpCheckSummary,
  type McpServerConfig,
  type McpServersStore,
  type McpTransport,
} from './types.js'

export type McpMutationResult<T = {}> = ({ ok: true } & T) | { ok: false; status?: number; error: string }

function mcpServersFile(): string {
  return joinPath(registryHome(), 'mcp-servers.json')
}

function emptyStore(): McpServersStore {
  return { version: MCP_SERVERS_VERSION, servers: [] }
}

function toStringRecord(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k.trim()) continue
    if (typeof v !== 'string') continue
    out[k] = v
  }
  return out
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

/** Record không hợp lệ bị bỏ im lặng — file registry là dữ liệu ngoài, không phải contract. */
export function normaliseMcpServer(raw: any): McpServerConfig | null {
  const id = sanitiseMcpServerId(raw?.id)
  if (!id) return null
  const transport = String(raw?.transport || '') as McpTransport
  if (!(MCP_TRANSPORTS as readonly string[]).includes(transport)) return null

  const base = {
    id,
    label: String(raw.label || id).slice(0, 128),
    enabled: raw.enabled !== false,
    ...(toPositiveInt(raw.timeoutMs) ? { timeoutMs: toPositiveInt(raw.timeoutMs) } : {}),
    lastCheck: normaliseCheckSummary(raw.lastCheck),
  }

  if (transport === 'stdio') {
    const command = String(raw.command || '').trim()
    if (!command) return null
    return {
      ...base,
      transport,
      command,
      args: Array.isArray(raw.args) ? raw.args.filter((a: unknown): a is string => typeof a === 'string') : [],
      env: toStringRecord(raw.env),
      ...(typeof raw.cwd === 'string' && raw.cwd.trim() ? { cwd: raw.cwd.trim() } : {}),
    }
  }

  const url = String(raw.url || '').trim()
  if (!url) return null
  return {
    ...base,
    transport,
    url,
    credentialId: typeof raw.credentialId === 'string' && raw.credentialId ? raw.credentialId : null,
    ...(typeof raw.authHeader === 'string' && raw.authHeader.trim() ? { authHeader: raw.authHeader.trim() } : {}),
    ...(typeof raw.authScheme === 'string' && raw.authScheme.trim() ? { authScheme: raw.authScheme.trim() } : {}),
    headers: toStringRecord(raw.headers),
  }
}

export function loadMcpServers(): McpServersStore {
  const file = mcpServersFile()
  let raw: string
  try {
    raw = readTextFileSync(file)
  } catch {
    return emptyStore()
  }
  try {
    const data = JSON.parse(raw.replace(/^\uFEFF/, ''))
    if (!data || !Array.isArray(data.servers)) return emptyStore()
    return {
      version: data.version || MCP_SERVERS_VERSION,
      servers: data.servers.map(normaliseMcpServer).filter(Boolean) as McpServerConfig[],
    }
  } catch {
    console.warn(`[dev-team-dashboard] mcp-servers.json corrupt: ${file}`)
    return emptyStore()
  }
}

export function saveMcpServers(store: McpServersStore): McpServersStore {
  const home = registryHome()
  mkdirSync(home, { recursive: true })
  writeTextFileAtomicSync(mcpServersFile(), JSON.stringify(
    { version: store.version || MCP_SERVERS_VERSION, servers: store.servers || [] },
    null,
    2,
  ))
  return store
}

export function listMcpServers(): McpServerConfig[] {
  return loadMcpServers().servers
}

export function getMcpServer(id: unknown): McpServerConfig | null {
  const clean = sanitiseMcpServerId(id)
  if (!clean) return null
  return loadMcpServers().servers.find((s) => s.id === clean) || null
}

export function upsertMcpServer(input: any): McpMutationResult<{ server: McpServerConfig }> {
  const id = sanitiseMcpServerId(input?.id)
  if (!id) return { ok: false, status: 400, error: 'invalid mcp server id' }
  const entry = normaliseMcpServer({ ...input, id })
  if (!entry) return { ok: false, status: 400, error: 'invalid mcp server config' }

  const store = loadMcpServers()
  const idx = store.servers.findIndex((s) => s.id === id)
  const previous = idx >= 0 ? store.servers[idx] : null
  // `lastCheck` là kết quả đo, không phải thứ form gửi lên — giữ lại bản cũ.
  // `***` ở env/headers cũng vậy: đó là bản mask client nhận từ API, không phải
  // giá trị người dùng vừa nhập.
  const merged = mergeMaskedSecrets(entry, previous)
  merged.lastCheck = entry.lastCheck ?? previous?.lastCheck ?? null
  if (previous) store.servers[idx] = merged
  else store.servers.push(merged)
  saveMcpServers(store)
  return { ok: true, server: merged }
}

/**
 * DELETE idempotent: id lạ vẫn `ok` — người dùng đã đạt được trạng thái họ muốn.
 * Trả luôn `id` đã sanitise để caller dùng chung một giá trị cho audit, event và
 * response, thay vì lặp lại chuỗi thô từ query string.
 */
export function deleteMcpServer(id: unknown): McpMutationResult<{ deleted: boolean; id: string }> {
  const clean = sanitiseMcpServerId(id)
  if (!clean) return { ok: false, status: 400, error: 'invalid id' }
  const store = loadMcpServers()
  const idx = store.servers.findIndex((s) => s.id === clean)
  if (idx < 0) return { ok: true, deleted: false, id: clean }
  store.servers.splice(idx, 1)
  saveMcpServers(store)
  return { ok: true, deleted: true, id: clean }
}

/** Bỏ qua im lặng khi id chưa có trong store — bản nháp chưa lưu vẫn test được. */
export function recordCheckResult(id: unknown, summary: McpCheckSummary): void {
  const clean = sanitiseMcpServerId(id)
  if (!clean) return
  const store = loadMcpServers()
  const idx = store.servers.findIndex((s) => s.id === clean)
  if (idx < 0) return
  store.servers[idx] = { ...store.servers[idx], lastCheck: summary }
  saveMcpServers(store)
}
