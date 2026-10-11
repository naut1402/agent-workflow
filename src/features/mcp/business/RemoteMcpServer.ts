import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { isPrivateHostname } from '../../../backend/lib/netUtils.js'
import {
  MCP_DEFAULT_AUTH_HEADER,
  MCP_DEFAULT_AUTH_SCHEME,
  type McpRemoteServer,
  type McpServerConfig,
} from '../schemas/mcpServer.js'
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

// xem docs/mcp/client.md §4
const LOOPBACK_LITERALS = new Set(['::1', '[::1]', '0.0.0.0'])

const MAX_REDIRECT_HOPS = 3
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

type McpRemoteTransport = McpRemoteServer['transport']

/** MCP server từ xa — `http` (Streamable HTTP) hoặc `sse`. */
export class RemoteMcpServer extends McpServer<McpRemoteServer> {
  constructor(config: McpRemoteServer) {
    super(config)
  }

  static isAllowedHost(hostname: string): boolean {
    const host = (hostname || '').toLowerCase()
    return isPrivateHostname(host) || LOOPBACK_LITERALS.has(host)
  }

  /** `https` mọi host; `http` chỉ loopback/private. Ném Error khi không hợp lệ. */
  static assertEndpoint(urlStr: unknown): URL {
    let u: URL
    try {
      u = new URL(String(urlStr))
    } catch {
      throw new Error('mcp: invalid URL')
    }
    if (u.protocol === 'https:') return u
    if (u.protocol === 'http:') {
      if (RemoteMcpServer.isAllowedHost(u.hostname)) return u
      throw new Error('mcp: http chỉ được dùng với host loopback/private')
    }
    throw new Error('mcp: chỉ chấp nhận https, hoặc http trên loopback/private')
  }

  /** Bản ghi đã chuẩn hoá — `null` khi `url` rỗng. */
  static normalise(
    raw: any,
    base: McpServerBaseFields,
    transport: McpRemoteTransport,
  ): RemoteMcpServer | null {
    const url = String(raw.url || '').trim()
    if (!url) return null
    return new RemoteMcpServer({
      ...base,
      transport,
      url,
      credentialId: typeof raw.credentialId === 'string' && raw.credentialId ? raw.credentialId : null,
      ...(typeof raw.authHeader === 'string' && raw.authHeader.trim() ? { authHeader: raw.authHeader.trim() } : {}),
      ...(typeof raw.authScheme === 'string' && raw.authScheme.trim() ? { authScheme: raw.authScheme.trim() } : {}),
      headers: McpServer.toStringRecord(raw.headers),
    })
  }

  protected rebuild(config: McpRemoteServer): RemoteMcpServer {
    return new RemoteMcpServer(config)
  }

  masked(): McpRemoteServer {
    return { ...this.config, headers: SecretMasker.maskRecord(this.config.headers) }
  }

  restoreMasked(previous: McpServer | null, _warnings?: string[]): RemoteMcpServer {
    const next = this.config
    const prev = previous && isRemoteConfig(previous.config) ? previous.config.headers : {}
    return new RemoteMcpServer({ ...next, headers: McpServer.restoreMaskedRecord(next.headers, prev) })
  }

  secretValues(): string[] {
    return Object.values(this.config.headers || {}).filter(SecretMasker.isMaskable)
  }

  destination(): string {
    return `${this.config.transport} ${this.config.url}`
  }

  needsStoredSecret(): boolean {
    return Object.values(this.config.headers || {}).some((v) => v === SecretMasker.MASK)
  }

  assertEndpoint(): void {
    RemoteMcpServer.assertEndpoint(this.config.url)
  }

  /** Giải header: header gõ tay trước, credential ghi đè sau. */
  resolve(ctx?: McpResolveContext): ResolvedMcpServer {
    const server = this.config
    const secret = server.credentialId ? ctx?.credentials?.secretFor(server.credentialId) ?? null : null
    const { values: headers, warnings } = McpServer.resolveEnvRefs(server.headers)
    if (secret) {
      const name = server.authHeader?.trim() || MCP_DEFAULT_AUTH_HEADER
      const scheme = server.authScheme?.trim() || MCP_DEFAULT_AUTH_SCHEME
      headers[name] = scheme ? `${scheme} ${secret}` : secret
    } else if (server.credentialId) {
      warnings.push(`credential ${server.credentialId}: không giải được secret — bỏ header xác thực`)
    }
    return { values: headers, secret, warnings }
  }

  toCliEntry(ctx: McpCliContext): McpCliEntry {
    const server = this.config
    const secrets = this.secretValues()
    const resolved = this.resolve(ctx)
    if (resolved.secret) secrets.push(resolved.secret)
    secrets.push(...Object.values(resolved.values).filter(SecretMasker.isMaskable))
    return {
      entry: {
        type: server.transport,
        url: server.url,
        headers: resolved.values,
      },
      secrets,
      warnings: McpServer.prefix(server.id, resolved.warnings),
    }
  }

  createTransport(opts: McpTransportOptions = {}): McpTransportPlan {
    const server = this.config
    const url = RemoteMcpServer.assertEndpoint(server.url)
    const resolved = this.resolve(opts)
    const headers = resolved.values
    // xem docs/architecture/code/mcp.md §5
    const common = { requestInit: { headers }, fetch: guardedFetch(headers, url.origin) }
    return {
      transport:
        server.transport === 'sse'
          ? new SSEClientTransport(url, common)
          : new StreamableHTTPClientTransport(url, common),
      secrets: Object.values(headers).filter(SecretMasker.isMaskable),
      warnings: resolved.warnings,
    }
  }
}

function isRemoteConfig(config: McpServerConfig): config is McpRemoteServer {
  return config.transport === 'http' || config.transport === 'sse'
}

// xem docs/architecture/code/mcp.md §5
function guardedFetch(headers: Record<string, string>, origin: string): FetchLike {
  const ownKeys = new Set(Object.keys(headers).map((k) => k.toLowerCase()))
  const SESSION_KEY = 'mcp-session-id'

  return async (url, init) => {
    let current = new URL(String(url))
    let injected: Record<string, string> = { ...headers }
    let stripInherited = false
    let body = init?.body
    let method = init?.method ?? 'GET'

    for (let hop = 0; ; hop++) {
      if (hop > MAX_REDIRECT_HOPS) {
        throw new Error(`mcp: vượt quá ${MAX_REDIRECT_HOPS} lần chuyển hướng`)
      }
      RemoteMcpServer.assertEndpoint(current)

      const outHeaders = new Headers()
      for (const [key, value] of new Headers(init?.headers).entries()) {
        if (ownKeys.has(key)) continue
        if (stripInherited && key === SESSION_KEY) continue
        outHeaders.set(key, value)
      }
      for (const [key, value] of Object.entries(injected)) outHeaders.set(key, value)

      const res = await fetch(current, {
        ...init,
        method,
        body,
        headers: outHeaders,
        redirect: 'manual',
      })
      if (!REDIRECT_STATUSES.has(res.status)) return res

      const location = res.headers.get('location')
      if (!location) return res

      let next: URL
      try {
        next = new URL(location, current)
      } catch {
        return res
      }

      const keepsBody = res.status === 307 || res.status === 308
      if (keepsBody && body !== undefined && typeof body !== 'string' && !(body instanceof Uint8Array)) {
        return res
      }

      await res.body?.cancel().catch(() => {})

      if (next.origin !== origin) {
        injected = {}
        stripInherited = true
      }
      if (!keepsBody) {
        method = 'GET'
        body = undefined
      }
      current = next
    }
  }
}
