import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { isPrivateHostname } from '../../agent-editor/business/index.js'
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

// Chốt riêng cho endpoint MCP, cố ý KHÔNG dùng `fetchUrlSafe`: MCP server cục bộ
// (playwright, serena) chạy trên loopback qua http, đúng thứ `fetchUrlSafe` chặn.
// Nới `fetchUrlSafe` sẽ mở bề mặt SSRF ở mọi call site khác của nó.
const LOOPBACK_LITERALS = new Set(['::1', '[::1]', '0.0.0.0'])

/** Đủ cho chuỗi redirect thật (`/mcp` → `/mcp/` → canonical host); hơn nữa là vòng lặp. */
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

  /** 📌 Guard `url` rỗng ⇒ `null` ở đây, cùng lý do với `StdioMcpServer.normalise`. */
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

  /**
   * Thứ tự cố định: header gõ tay trước, credential ghi đè sau. Credential đã
   * chọn là nguồn sự thật; ô gõ tay chỉ để bổ sung khoá khác.
   */
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
    // Cả giá trị gõ tay lẫn giá trị đã giải đều đi vào file config, nên cả hai
    // phải nằm trong danh sách mask log.
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
    // `requestInit` chỉ áp cho POST; stream GET của SSE lấy fetch ở tuỳ chọn gốc,
    // nên header phải đi qua `fetch` chứ không chỉ `requestInit`.
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

/**
 * `fetch` tự đi từng hop thay vì để runtime đi hộ. Hai lý do, cả hai đều là lỗ
 * bảo mật thật của bản trước:
 *
 *  1. `assertEndpoint` chỉ chạy trên URL người dùng khai. Với `redirect: 'follow'`
 *     mặc định, một server `https` hợp lệ trả 302 sang `http://attacker.example`
 *     là chính sách endpoint bị đi vòng hoàn toàn — nên guard chạy lại ở MỌI hop.
 *  2. Header ta tiêm (`Authorization`, `X-API-Key`, … do người dùng đặt) bám theo
 *     redirect sang origin lạ ⇒ secret rời tiến trình. Đổi origin là bỏ sạch.
 *
 * `origin` chốt theo URL NGƯỜI DÙNG KHAI, không phải hop trước: redirect
 * A→B→A không được khôi phục header — B đã biết đường dẫn, A có thể là B dựng.
 *
 * ⚠️ Bỏ `injected` là CHƯA ĐỦ, và đây là chỗ bản trước vá hụt: SDK đã gộp sẵn
 * header của ta vào `init.headers` ở `_commonHeaders()`
 * (`@modelcontextprotocol/sdk` `client/streamableHttp.js`, `client/sse.js`), nên
 * spread `init.headers` tiêm lại nguyên vẹn đúng những khoá vừa xoá. Phải lọc
 * cả phần KẾ THỪA theo tên khoá — xem `injectedKeys` / `stripInherited`.
 */
function guardedFetch(headers: Record<string, string>, origin: string): FetchLike {
  // So theo tên khoá đã hạ chữ thường: `Headers` chuẩn hoá về chữ thường, còn
  // `headers` là do người dùng gõ (`X-API-Key`) nên hai bên không khớp nếu so thô.
  const ownKeys = new Set(Object.keys(headers).map((k) => k.toLowerCase()))
  // Định danh phiên do origin GỐC cấp — gửi sang origin lạ là trao cho nó một
  // phiên hợp lệ của server khác. Không phải secret người dùng khai nhưng cùng
  // lớp rủi ro, nên cùng diện gỡ — chỉ khi đổi origin, vì cùng origin thì SDK
  // bắt buộc phải echo lại nó.
  const SESSION_KEY = 'mcp-session-id'

  return async (url, init) => {
    let current = new URL(String(url))
    let injected: Record<string, string> = { ...headers }
    // Bật khi đã rời origin gốc: từ đó trở đi `init.headers` 🚫 không được mang
    // khoá nào thuộc `injectedKeys` nữa.
    let stripInherited = false
    let body = init?.body
    let method = init?.method ?? 'GET'

    for (let hop = 0; ; hop++) {
      if (hop > MAX_REDIRECT_HOPS) {
        throw new Error(`mcp: vượt quá ${MAX_REDIRECT_HOPS} lần chuyển hướng`)
      }
      RemoteMcpServer.assertEndpoint(current)

      // Dựng bằng `Headers` chứ 🚫 không phải object spread: `init.headers` đã
      // chuẩn hoá về chữ thường (`x-api-key`) còn `injected` giữ nguyên dạng
      // người dùng gõ (`X-API-Key`), nên spread hai bên để lại HAI khoá và
      // `fetch` gửi đi `"tok, tok"` — server nào so khớp chặt sẽ từ chối.
      const outHeaders = new Headers()
      for (const [key, value] of new Headers(init?.headers).entries()) {
        // Khoá của ta: luôn bỏ ở đây rồi đặt lại từ `injected` bên dưới. Khi đã
        // đổi origin thì `injected` rỗng ⇒ khoá biến mất hẳn, đúng ý đồ.
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
      // 3xx không `Location` không phải redirect — trả nguyên cho SDK tự xử.
      if (!location) return res

      let next: URL
      try {
        next = new URL(location, current)
      } catch {
        return res
      }

      // 307/308 giữ nguyên method + body. `init.body` của SDK là chuỗi JSON nên
      // gửi lại an toàn; thứ gì khác có thể là stream đã tiêu thụ ⇒ 🚫 không đoán,
      // trả thẳng 3xx cho SDK.
      const keepsBody = res.status === 307 || res.status === 308
      if (keepsBody && body !== undefined && typeof body !== 'string' && !(body instanceof Uint8Array)) {
        return res
      }

      // Không huỷ body của 3xx là rò socket — response đã mở nhưng không ai đọc.
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
