import { isPrivateHostname } from '../../agent-editor/business/index.js'

// Chốt riêng cho endpoint MCP, cố ý KHÔNG dùng `fetchUrlSafe`: MCP server cục bộ
// (playwright, serena) chạy trên loopback qua http, đúng thứ `fetchUrlSafe` chặn.
// Nới `fetchUrlSafe` sẽ mở bề mặt SSRF ở mọi call site khác của nó.
const LOOPBACK_LITERALS = new Set(['::1', '[::1]', '0.0.0.0'])

export function isAllowedMcpHost(hostname: string): boolean {
  const host = (hostname || '').toLowerCase()
  return isPrivateHostname(host) || LOOPBACK_LITERALS.has(host)
}

/** `https` mọi host; `http` chỉ loopback/private. Ném Error khi không hợp lệ. */
export function assertMcpEndpoint(urlStr: unknown): URL {
  let u: URL
  try {
    u = new URL(String(urlStr))
  } catch {
    throw new Error('mcp: invalid URL')
  }
  if (u.protocol === 'https:') return u
  if (u.protocol === 'http:') {
    if (isAllowedMcpHost(u.hostname)) return u
    throw new Error('mcp: http chỉ được dùng với host loopback/private')
  }
  throw new Error('mcp: chỉ chấp nhận https, hoặc http trên loopback/private')
}
