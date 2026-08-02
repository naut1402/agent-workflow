/**
 * Ghép messages từ:
 * - `src/plugins/i18n/locales/<namespace>/<locale>.ts` (vd common)
 * - `src/features/<feature>/locales/<locale>.ts`
 *
 * Namespace feature = kebab-case folder → camelCase (`agent-editor` → `agentEditor`).
 * Mỗi file `export default { ... }` là object message của namespace đó.
 */

function kebabToCamel(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

function takeDefault(mod: unknown): Record<string, unknown> {
  if (mod && typeof mod === 'object' && 'default' in mod) {
    return (mod as { default: Record<string, unknown> }).default
  }
  return (mod || {}) as Record<string, unknown>
}

type LocaleBucket = Record<string, Record<string, unknown>>

/**
 * Eager glob — Vite/Vitest transform. Pattern cố định (không dùng biến).
 * Tránh chuỗi đóng block-comment trong JSDoc.
 */
export function loadLocaleMessages(): Record<string, LocaleBucket> {
  const byLocale: Record<string, LocaleBucket> = {}

  const pluginMods = import.meta.glob('./locales/*/*.ts', { eager: true })
  for (const [filePath, mod] of Object.entries(pluginMods)) {
    // ./locales/common/vi.ts
    const m = filePath.match(/\/locales\/([^/]+)\/([^/]+)\.ts$/)
    if (!m) continue
    const namespace = m[1]
    const locale = m[2]
    if (!byLocale[locale]) byLocale[locale] = {}
    byLocale[locale][namespace] = takeDefault(mod)
  }

  const featureMods = import.meta.glob('../../features/*/locales/*.ts', { eager: true })
  for (const [filePath, mod] of Object.entries(featureMods)) {
    // .../features/agent-editor/locales/vi.ts
    const m = filePath.match(/\/features\/([^/]+)\/locales\/([^/]+)\.ts$/)
    if (!m) continue
    const namespace = kebabToCamel(m[1])
    const locale = m[2]
    if (!byLocale[locale]) byLocale[locale] = {}
    byLocale[locale][namespace] = takeDefault(mod)
  }

  return byLocale
}
