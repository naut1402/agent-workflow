/**
 * Phân loại hostname theo dải mạng — chặn SSRF ở mọi đường gọi ra ngoài:
 * `fetchUrlSafe` (agent-editor), `sanitiseGitUrl` (monitor) và guard endpoint
 * MCP (mcp). Ba feature cùng dùng nên nằm ở lib, không ở feature nào sở hữu.
 */

/** True for hostnames that resolve to private / loopback ranges (SSRF guard). */
export function isPrivateHostname(hostname: string): boolean {
  const h = (hostname || '').toLowerCase()
  if (h === 'localhost' || h.endsWith('.local')) return true
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true
  return false
}
