import { z } from 'zod'

/** Server-side job-recovery block inside global dashboard settings.json. */
export const RecoverySettingsSchema = z.object({
  /** Master switch — off falls back to pre-#209 behaviour (every failure → `failed`). */
  enabled: z.boolean().default(true),
  /** Max retry attempts for `process_crash` before giving up (`failed`). */
  maxAttempts: z.number().int().min(1).max(10).optional(),
  /** Backoff schedule (ms) per `process_crash` attempt; last value repeats past the array length. */
  backoffMs: z.array(z.number().int().positive()).min(1).optional(),
  /** Poller interval (ms) that scans `recover/` for due entries. Not exposed in UI yet. */
  pollIntervalMs: z.number().int().positive().optional(),
  /** Default resume delay (ms) for `network` failures when no explicit reset hint exists. */
  networkResumeDelayMs: z.number().int().positive().optional(),
  /** Default resume delay (ms) for `usage_limit` failures when no parsed reset time exists. */
  usageLimitResumeDelayMs: z.number().int().positive().optional(),
})

export type RecoverySettings = z.infer<typeof RecoverySettingsSchema>

export const DEFAULT_RECOVERY_SETTINGS: RecoverySettings = {
  enabled: true,
  maxAttempts: 3,
  backoffMs: [5_000, 15_000, 45_000],
  pollIntervalMs: 30_000,
  networkResumeDelayMs: 30_000,
  usageLimitResumeDelayMs: 60 * 60_000,
}

export function parseRecoverySettings(raw: unknown): RecoverySettings {
  const parsed = RecoverySettingsSchema.safeParse(raw)
  if (!parsed.success) return { ...DEFAULT_RECOVERY_SETTINGS, backoffMs: [...DEFAULT_RECOVERY_SETTINGS.backoffMs!] }
  return {
    enabled: parsed.data.enabled,
    maxAttempts: parsed.data.maxAttempts ?? DEFAULT_RECOVERY_SETTINGS.maxAttempts,
    backoffMs: parsed.data.backoffMs?.length ? parsed.data.backoffMs : [...DEFAULT_RECOVERY_SETTINGS.backoffMs!],
    pollIntervalMs: parsed.data.pollIntervalMs ?? DEFAULT_RECOVERY_SETTINGS.pollIntervalMs,
    networkResumeDelayMs: parsed.data.networkResumeDelayMs ?? DEFAULT_RECOVERY_SETTINGS.networkResumeDelayMs,
    usageLimitResumeDelayMs:
      parsed.data.usageLimitResumeDelayMs ?? DEFAULT_RECOVERY_SETTINGS.usageLimitResumeDelayMs,
  }
}

export function resolveRecoveryMaxAttempts(config: Pick<RecoverySettings, 'maxAttempts'> | null | undefined): number {
  const n = config?.maxAttempts
  return typeof n === 'number' && n > 0 ? n : DEFAULT_RECOVERY_SETTINGS.maxAttempts!
}

export function resolveRecoveryBackoffMs(config: Pick<RecoverySettings, 'backoffMs'> | null | undefined): number[] {
  return config?.backoffMs?.length ? config.backoffMs : [...DEFAULT_RECOVERY_SETTINGS.backoffMs!]
}

export function resolveRecoveryPollIntervalMs(
  config: Pick<RecoverySettings, 'pollIntervalMs'> | null | undefined,
): number {
  const n = config?.pollIntervalMs
  return typeof n === 'number' && n > 0 ? n : DEFAULT_RECOVERY_SETTINGS.pollIntervalMs!
}
