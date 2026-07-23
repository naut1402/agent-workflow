import { z } from 'zod'

/** Server-side autoscan config (`~/.dev-team-dashboard/autoscan.json`). */
export const AutoscanConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** Absolute directories to scan for project roots containing `.dev-team-agent`. */
  whitelist: z.array(z.string()).default([]),
  /** Client poll interval when enabled (ms). Missing → 60_000. */
  intervalMs: z.number().int().positive().max(3_600_000).optional(),
})

export type AutoscanConfig = z.infer<typeof AutoscanConfigSchema>

export const DEFAULT_AUTOSCAN_CONFIG: AutoscanConfig = {
  enabled: false,
  whitelist: [],
  intervalMs: 60_000,
}

export function parseAutoscanConfig(raw: unknown): AutoscanConfig {
  const parsed = AutoscanConfigSchema.safeParse(raw)
  if (!parsed.success) return { ...DEFAULT_AUTOSCAN_CONFIG }
  return {
    enabled: parsed.data.enabled,
    whitelist: parsed.data.whitelist,
    intervalMs: parsed.data.intervalMs ?? DEFAULT_AUTOSCAN_CONFIG.intervalMs,
  }
}

export function resolveAutoscanIntervalMs(
  config: Pick<AutoscanConfig, 'intervalMs'> | null | undefined,
): number {
  const n = config?.intervalMs
  return typeof n === 'number' && n > 0 ? n : 60_000
}
