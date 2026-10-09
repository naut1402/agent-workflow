import { z } from 'zod'

/** Server không biết ModeRegistry (registry ở FE) nên chỉ chặn key dị dạng, không validate danh sách. */
export const MODE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

/** Chặn settings.json phình do client hỏng ghi bừa. */
export const MODES_MAX_KEYS = 64

// xem docs/architecture/code/settings.md §1
export const ModesConfigSchema = z
  .object({
    enabled: z.record(z.unknown()).optional(),
  })
  .passthrough()

export type ModesConfig = { enabled: Record<string, boolean> }

export const DEFAULT_MODES_CONFIG: ModesConfig = { enabled: {} }

/**
 * Tolerant on input: một entry rác bị bỏ riêng nó thay vì làm hỏng cả map, để
 * một dòng sửa tay sai trong settings.json không xoá phần còn lại.
 */
export function parseModesConfig(raw: unknown): ModesConfig {
  const parsed = ModesConfigSchema.safeParse(raw ?? {})
  if (!parsed.success) return { enabled: {} }
  const enabled: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(parsed.data.enabled ?? {})) {
    if (typeof value !== 'boolean' || !MODE_KEY_PATTERN.test(key)) continue
    if (Object.keys(enabled).length >= MODES_MAX_KEYS) break
    enabled[key] = value
  }
  return { enabled }
}

/** Thiếu key → `fallback` (defaultEnabled của ModeEntry). Key lạ → không ai hỏi tới. */
export function resolveModeEnabled(
  config: ModesConfig | null | undefined,
  modeKey: string,
  fallback: boolean,
): boolean {
  const value = config?.enabled?.[modeKey]
  return typeof value === 'boolean' ? value : fallback
}
