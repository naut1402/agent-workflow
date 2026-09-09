import { z } from 'zod'

/** Rate-limit override for a specific route/route-group prefix. */
export const RateLimitRouteConfigSchema = z.object({
  pattern: z.string().min(1),
  windowMs: z.number().int().positive(),
  max: z.number().int().positive(),
})

export const RateLimitConfigSchema = z.object({
  enabled: z.boolean().default(false),
  windowMs: z.number().int().positive().default(60_000),
  max: z.number().int().positive().default(120),
  routes: z.array(RateLimitRouteConfigSchema).default([]),
})

export const CorsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  allowedOrigins: z.array(z.string()).default([]),
  allowCredentials: z.boolean().default(false),
})

export const SecurityConfigSchema = z.object({
  rateLimit: RateLimitConfigSchema.optional(),
  cors: CorsConfigSchema.optional(),
})

export type RateLimitRouteConfig = z.infer<typeof RateLimitRouteConfigSchema>
export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>
export type CorsConfig = z.infer<typeof CorsConfigSchema>
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  rateLimit: { enabled: false, windowMs: 60_000, max: 120, routes: [] },
  cors: { enabled: false, allowedOrigins: [], allowCredentials: false },
}

export function parseSecurityConfig(raw: unknown): SecurityConfig {
  const parsed = SecurityConfigSchema.safeParse(raw)
  if (!parsed.success) {
    return { rateLimit: { ...DEFAULT_SECURITY_CONFIG.rateLimit! }, cors: { ...DEFAULT_SECURITY_CONFIG.cors! } }
  }
  return {
    rateLimit: { ...DEFAULT_SECURITY_CONFIG.rateLimit!, ...parsed.data.rateLimit },
    cors: { ...DEFAULT_SECURITY_CONFIG.cors!, ...parsed.data.cors },
  }
}
