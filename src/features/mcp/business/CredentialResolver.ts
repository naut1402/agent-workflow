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

/**
 * Hiện thực đã đăng ký cho tiến trình này. Bên nắm store (`runner/business/registry.ts`)
 * gọi `useCredentialResolver` lúc nạp module; caller không nhận resolver qua tham
 * số (`mcp/controller.ts`) lấy lại bằng `credentialResolver()`. Nhờ vậy `mcp` 🚫
 * import `runner` mà vẫn giải được credential — cạnh ngược đó là vòng `mcp` ⇄ `runner`.
 */
let registered: CredentialResolver | null = null

/** Đăng ký hiện thực của cổng — bản gọi sau thay bản trước. */
export function useCredentialResolver(resolver: CredentialResolver): void {
  registered = resolver
}

/**
 * `null` ⇒ tiến trình chưa nạp bên nắm store (tiến trình stdio `mcp/stdio.ts`, test
 * chỉ nạp `mcp`). Truyền thẳng `null` xuống `McpClient` là đúng: server từ xa chạy
 * không header xác thực kèm cảnh báo, y như khi credential không giải được.
 */
export function credentialResolver(): CredentialResolver | null {
  return registered
}
