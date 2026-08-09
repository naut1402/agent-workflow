import { joinPath, mkdirSync, readTextFileSync, renameSync, writeTextFileSync } from '../../../core/lib/fileHelper.js'
import { spawnSync } from '../../../core/lib/processHelper.js'
import { registryHome } from '../../../core/registry.js'
import { listCustomCommands } from './commands.js'
import {
  CONNECTIONS_VERSION,
  DEFAULT_CONNECTION_ID,
  sanitiseConnectionId,
  type Connection,
  type ConnectionKind,
  type ConnectionsStore,
  type MutationResult,
  type ProviderCatalogEntry,
  type ScannedCommand,
} from './types.js'

const LOCAL_COMMANDS: Array<{ id: string; command: string; providerId: string; label: string }> = [
  { id: 'claude', command: 'claude', providerId: 'claude-code-cli', label: 'Claude Code CLI' },
  { id: 'cursor', command: 'agent', providerId: 'cursor-cli', label: 'Cursor CLI' },
  { id: 'codex', command: 'codex', providerId: 'codex-cli', label: 'Codex CLI' },
]

const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  { id: 'claude-code-cli', kind: 'local-console', label: 'Claude Code CLI', family: 'agent-cli' },
  { id: 'cursor-cli', kind: 'local-console', label: 'Cursor CLI', family: 'agent-cli' },
  { id: 'codex-cli', kind: 'local-console', label: 'Codex CLI', family: 'agent-cli' },
  { id: 'console-command', kind: 'local-console', label: 'Console command', family: 'console-command' },
  { id: 'anthropic-api', kind: 'ai-provider', label: 'Anthropic API', family: 'ai-api' },
]

function connectionsFile(): string {
  return joinPath(registryHome(), 'connections.json')
}

function emptyStore(): ConnectionsStore {
  return {
    version: CONNECTIONS_VERSION,
    connections: [
      {
        id: DEFAULT_CONNECTION_ID,
        label: 'Claude Code (local console)',
        kind: 'local-console',
        providerId: 'claude-code-cli',
        cliPath: 'claude',
        flags: [],
        credentialId: null,
      },
    ],
  }
}

export function loadConnections(): ConnectionsStore {
  const file = connectionsFile()
  let raw: string
  try {
    raw = readTextFileSync(file)
  } catch {
    return emptyStore()
  }
  try {
    const data = JSON.parse(raw)
    if (!data || !Array.isArray(data.connections)) return emptyStore()
    return {
      version: data.version || CONNECTIONS_VERSION,
      connections: data.connections.map(normaliseConnection).filter(Boolean) as Connection[],
    }
  } catch {
    console.warn(`[dev-team-dashboard] connections.json corrupt: ${file}`)
    return emptyStore()
  }
}

function normaliseConnection(raw: any): Connection | null {
  const id = sanitiseConnectionId(raw?.id)
  if (!id) return null
  const kind: ConnectionKind = raw.kind === 'ai-provider' ? 'ai-provider' : 'local-console'
  const providerId = String(raw.providerId || '').trim()
  if (!providerId) return null
  return {
    id,
    label: String(raw.label || id).slice(0, 128),
    kind,
    providerId,
    cliPath: raw.cliPath != null ? String(raw.cliPath) : undefined,
    flags: Array.isArray(raw.flags) ? raw.flags.map(String) : [],
    credentialId: raw.credentialId != null ? String(raw.credentialId) : null,
    config: raw.config && typeof raw.config === 'object' ? raw.config : undefined,
  }
}

export function saveConnections(store: ConnectionsStore): ConnectionsStore {
  const home = registryHome()
  mkdirSync(home, { recursive: true })
  const file = connectionsFile()
  const tmp = `${file}.tmp`
  const payload = JSON.stringify(
    {
      version: store.version || CONNECTIONS_VERSION,
      connections: store.connections || [],
    },
    null,
    2,
  )
  writeTextFileSync(tmp, payload)
  renameSync(tmp, file)
  return store
}

export function listConnections(): Connection[] {
  return loadConnections().connections
}

export function getConnection(id: unknown): Connection | null {
  const clean = sanitiseConnectionId(id)
  if (!clean) return null
  return loadConnections().connections.find((c) => c.id === clean) || null
}

export function upsertConnection(input: any): MutationResult<{ connection: Connection }> {
  const id = sanitiseConnectionId(input?.id)
  if (!id) return { ok: false, error: 'invalid connection id' }
  const kind: ConnectionKind = input.kind === 'ai-provider' ? 'ai-provider' : 'local-console'
  const providerId = String(input.providerId || '').trim()
  if (!providerId) return { ok: false, error: 'providerId is required' }
  if (kind === 'ai-provider' && !input.credentialId) {
    return { ok: false, error: 'credentialId is required for ai-provider' }
  }
  if (kind === 'local-console' && !input.cliPath) {
    return { ok: false, error: 'cliPath is required for local-console' }
  }

  const entry: Connection = {
    id,
    label: String(input.label || id).slice(0, 128),
    kind,
    providerId,
    cliPath: input.cliPath != null ? String(input.cliPath) : undefined,
    flags: Array.isArray(input.flags)
      ? input.flags.map(String)
      : typeof input.flags === 'string'
        ? input.flags
            .split(/\s+/)
            .map((s: string) => s.trim())
            .filter(Boolean)
        : [],
    credentialId: kind === 'ai-provider' ? String(input.credentialId) : null,
    config: input.config && typeof input.config === 'object' ? input.config : undefined,
  }

  const store = loadConnections()
  const idx = store.connections.findIndex((c) => c.id === id)
  if (idx >= 0) store.connections[idx] = entry
  else store.connections.push(entry)
  saveConnections(store)
  return { ok: true, connection: entry }
}

export function deleteConnection(id: unknown): MutationResult {
  const clean = sanitiseConnectionId(id)
  if (!clean) return { ok: false, status: 400, error: 'invalid id' }
  const store = loadConnections()
  if (store.connections.length <= 1) {
    return { ok: false, status: 400, error: 'cannot delete last connection' }
  }
  const idx = store.connections.findIndex((c) => c.id === clean)
  if (idx < 0) return { ok: false, status: 404, error: 'not found' }
  store.connections.splice(idx, 1)
  saveConnections(store)
  return { ok: true }
}

/** Ensure a connection exists for a legacy runner (provider + credentialId). Returns connection id. */
export function ensureLegacyConnection(legacy: {
  provider?: string
  credentialId?: string
  cliPath?: string
  flags?: unknown
}): string {
  const providerId = String(legacy.provider || 'claude-code-cli')
  const catalog = PROVIDER_CATALOG.find((p) => p.id === providerId)
  const kind: ConnectionKind = catalog?.kind || 'local-console'
  const preferredId =
    providerId === 'claude-code-cli' ? DEFAULT_CONNECTION_ID : `${providerId}-migrated`

  const existing = getConnection(preferredId)
  if (existing) return existing.id

  const cliPath =
    legacy.cliPath ||
    LOCAL_COMMANDS.find((c) => c.providerId === providerId)?.command ||
    providerId

  const result = upsertConnection({
    id: preferredId,
    label: catalog?.label || providerId,
    kind,
    providerId,
    cliPath: kind === 'local-console' ? cliPath : undefined,
    flags: Array.isArray(legacy.flags) ? legacy.flags : [],
    credentialId: kind === 'ai-provider' ? legacy.credentialId || null : null,
  })
  if ('error' in result) {
    // Fall back to default seed id if upsert somehow fails.
    return DEFAULT_CONNECTION_ID
  }
  return result.connection.id
}

export function listProviderCatalog(): ProviderCatalogEntry[] {
  return [...PROVIDER_CATALOG]
}

function resolveCommandPath(command: string): string | null {
  try {
    const isWin = process.platform === 'win32'
    const result = spawnSync(isWin ? 'where' : 'which', [command], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    })
    if (result.status !== 0) return null
    const out = String(result.stdout || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    return out[0] || null
  } catch {
    return null
  }
}

/** Scan known local console CLIs on PATH + custom commands — defensive, never throws. */
export function scanLocalCommands(): ScannedCommand[] {
  const builtin: ScannedCommand[] = LOCAL_COMMANDS.map((entry) => {
    const resolved = resolveCommandPath(entry.command)
    return {
      id: entry.id,
      command: entry.command,
      path: resolved,
      available: Boolean(resolved),
      providerId: entry.providerId,
      custom: false,
      flags: [],
    }
  })
  let custom: ScannedCommand[] = []
  try {
    custom = listCustomCommands().map((entry) => ({
      id: entry.id,
      command: entry.command,
      path: entry.path,
      available: true,
      providerId: entry.providerId,
      custom: true,
      flags: entry.flags || [],
    }))
  } catch {
    custom = []
  }
  return [...builtin, ...custom]
}
