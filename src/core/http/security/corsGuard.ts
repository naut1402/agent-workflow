import { cors } from 'hono/cors'
import type { MiddlewareHandler } from 'hono'
import type { HonoEnv } from '../types.js'
import type { CorsConfig } from '../../../features/settings/schemas/security.js'

export function createCorsMiddleware(loadConfig: () => CorsConfig): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const config = loadConfig()
    if (!config.enabled || !config.allowedOrigins.length) return next()
    return cors({ origin: config.allowedOrigins, credentials: config.allowCredentials })(c, next)
  }
}

/** Guard thủ công cho nhánh /api/knowledge — set header nếu origin khớp allowlist. */
export function resolveCorsHeaders(
  originHeader: string | undefined,
  config: CorsConfig,
): Record<string, string> | null {
  if (!config.enabled || !originHeader || !config.allowedOrigins.includes(originHeader)) return null
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': originHeader,
    Vary: 'Origin',
  }
  if (config.allowCredentials) headers['Access-Control-Allow-Credentials'] = 'true'
  return headers
}
