import { loadYaml } from '../../../shared/lib/yamlLib'

/**
 * Ghép messages từ `src/shared/locales/<locale>/<namespace>.yaml`.
 * Tên file là namespace (`agentEditor.yaml` → `agentEditor`).
 */

type LocaleBucket = Record<string, Record<string, unknown>>

/**
 * Eager glob — Vite/Vitest transform. Pattern cố định (không dùng biến).
 * Tránh chuỗi đóng block-comment trong JSDoc.
 */
export function loadLocaleMessages(): Record<string, LocaleBucket> {
  const byLocale: Record<string, LocaleBucket> = {}

  const mods = import.meta.glob<string>('../../../shared/locales/*/*.yaml', {
    eager: true,
    query: '?raw',
    import: 'default',
  })
  for (const [filePath, raw] of Object.entries(mods)) {
    // .../shared/locales/vi/agentEditor.yaml
    const m = filePath.match(/\/locales\/([^/]+)\/([^/]+)\.yaml$/)
    if (!m) continue
    const locale = m[1]
    const namespace = m[2]
    if (!byLocale[locale]) byLocale[locale] = {}
    byLocale[locale][namespace] = (loadYaml(raw) || {}) as Record<string, unknown>
  }

  return byLocale
}
