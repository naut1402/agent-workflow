/**
 * Cổng giải secret của credential profile cho server MCP từ xa.
 *
 * `mcp` 🚫 biết credential store (vault, `credentials.json` thuộc `runner`): bên
 * nắm store hiện thực interface này và tiêm vào qua `McpResolveContext` /
 * `McpProbeOptions` / `McpCliContext`. Chỉ `RemoteMcpServer.resolve` gọi nó —
 * credential được giải ở đúng một chỗ.
 *
 * `null` ⇒ không giải được (credential đã xoá, kiểu không phải secret trực tiếp,
 * vault khoá). Server sẽ chạy KHÔNG có header xác thực và kèm cảnh báo — 🚫 không ném.
 */
export interface CredentialResolver {
  secretFor(credentialId: string): string | null
}
