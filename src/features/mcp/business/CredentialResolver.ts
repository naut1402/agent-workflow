/** Cổng giải secret của credential profile cho server MCP từ xa — `null` ⇒ không giải được, không ném. */
export interface CredentialResolver {
  secretFor(credentialId: string): string | null
}

// xem docs/mcp/client.md §7
let registered: CredentialResolver | null = null

/** Đăng ký hiện thực của cổng — bản gọi sau thay bản trước. */
export function useCredentialResolver(resolver: CredentialResolver): void {
  registered = resolver
}

/** Hiện thực đã đăng ký — `null` khi tiến trình chưa đăng ký hiện thực nào. */
export function credentialResolver(): CredentialResolver | null {
  return registered
}
