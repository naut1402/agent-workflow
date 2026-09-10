import { z } from 'zod'

/**
 * Bật/tắt từng mode của shell, lưu ở nhánh `modes` trong settings.json.
 *
 * Chia sẻ giữa server và UI nên file này phải sạch `node:*` / fileHelper.
 * Chỉ chứa cấu hình — quyết định hiển thị nằm ở `core/shell/modeAccess.ts`.
 */

/** Server không biết ModeRegistry (registry ở FE) nên chỉ chặn key dị dạng, không validate danh sách. */
export const MODE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

/** Chặn settings.json phình do client hỏng ghi bừa; 9 mode hiện tại còn rất xa mức này. */
export const MODES_MAX_KEYS = 64

// `unknown` chứ không `boolean`: một entry sai kiểu phải bị bỏ riêng nó ở
// parseModesConfig, không làm safeParse hỏng cả map (xem doc bên dưới).
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
