import { z } from 'zod'

/**
 * Relative paths under project repo root used when scanning knowhow/docs
 * into the knowledge base (e.g. `docs`, `knowhow`, `README.md`).
 */
export const KnowledgeScanConfigSchema = z.object({
  /** When true, Knowledge panel may auto-scan on open (client-driven). */
  enabled: z.boolean().default(false),
  /** Relative include paths (dirs or markdown files). Empty → server defaults. */
  whitelist: z.array(z.string()).default([]),
})

export type KnowledgeScanConfig = z.infer<typeof KnowledgeScanConfigSchema>

export const DEFAULT_KNOWLEDGE_SCAN_CONFIG: KnowledgeScanConfig = {
  enabled: false,
  whitelist: ['docs', 'knowhow', 'knowledge', 'README.md'],
}

/** Reject absolute / traversal; keep portable relative segments. */
export function sanitiseKnowledgeScanPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const p = raw.trim().replace(/\\/g, '/')
  if (!p || p.length > 200) return null
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return null
  if (p.includes('..') || p.includes('\0')) return null
  if (!/^[A-Za-z0-9._@+/-]+$/.test(p)) return null
  return p
}

export function parseKnowledgeScanConfig(raw: unknown): KnowledgeScanConfig {
  const parsed = KnowledgeScanConfigSchema.safeParse(raw)
  if (!parsed.success) return { ...DEFAULT_KNOWLEDGE_SCAN_CONFIG, whitelist: [...DEFAULT_KNOWLEDGE_SCAN_CONFIG.whitelist] }
  const whitelist = [
    ...new Set(
      parsed.data.whitelist
        .map((p) => sanitiseKnowledgeScanPath(p))
        .filter((p): p is string => Boolean(p)),
    ),
  ]
  return {
    enabled: Boolean(parsed.data.enabled),
    whitelist,
  }
}
