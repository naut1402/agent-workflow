import {
  MCP_DEFAULT_AUTH_HEADER,
  MCP_DEFAULT_AUTH_SCHEME,
  MCP_ENV_REF_PATTERN,
  type McpRemoteServer,
} from './types.js'

export interface ResolveEnvResult {
  env: Record<string, string>
  warnings: string[]
}

/**
 * `env:NAME` → `process.env.NAME`. Biến không tồn tại thì BỎ HẲN khoá đó: ghi
 * literal `env:NAME` xuống server con còn tệ hơn thiếu biến, vì nó trông như
 * một token hợp lệ.
 */
export function resolveEnvRefs(env: Record<string, string> | undefined): ResolveEnvResult {
  const out: Record<string, string> = {}
  const warnings: string[] = []
  for (const [key, raw] of Object.entries(env || {})) {
    const match = MCP_ENV_REF_PATTERN.exec(raw)
    if (!match) {
      out[key] = raw
      continue
    }
    const value = process.env[match[1]]
    if (value == null || value === '') {
      warnings.push(`env ${key}: biến môi trường ${match[1]} chưa đặt — bỏ qua khoá này`)
      continue
    }
    out[key] = value
  }
  return { env: out, warnings }
}

/**
 * Thứ tự cố định: header gõ tay trước, credential ghi đè sau. Credential đã
 * chọn là nguồn sự thật; ô gõ tay chỉ để bổ sung khoá khác.
 */
export function resolveHeaders(
  server: McpRemoteServer,
  secret: string | null | undefined,
): ResolveEnvResult {
  const { env: headers, warnings } = resolveEnvRefs(server.headers)
  if (secret) {
    const name = server.authHeader?.trim() || MCP_DEFAULT_AUTH_HEADER
    const scheme = server.authScheme?.trim() || MCP_DEFAULT_AUTH_SCHEME
    headers[name] = scheme ? `${scheme} ${secret}` : secret
  } else if (server.credentialId) {
    warnings.push(`credential ${server.credentialId}: không giải được secret — bỏ header xác thực`)
  }
  return { env: headers, warnings }
}
