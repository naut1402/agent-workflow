/**
 * Ghép messages từ nguồn sự thật `src/shared/locales/<locale>/<namespace>.json`.
 * Tên file CHÍNH LÀ namespace (`agentEditor.json` → `agentEditor`).
 *
 * Hàm này giữ hai vai trò:
 * - **seed đồng bộ** lúc module load, nên `createI18n` có dữ liệu ngay như trước;
 * - **fallback offline** khi API i18n chết — UI vẫn có chữ của bản build.
 *
 * Chữ ký và kiểu trả về giữ nguyên để 53 file test đi qua `mountWithI18n` không phải sửa.
 */

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

  const mods = import.meta.glob('../../../shared/locales/*/*.json', { eager: true })
  for (const [filePath, mod] of Object.entries(mods)) {
    // .../shared/locales/vi/agentEditor.json
    const m = filePath.match(/\/locales\/([^/]+)\/([^/]+)\.json$/)
    if (!m) continue
    const locale = m[1]
    const namespace = m[2]
    if (!byLocale[locale]) byLocale[locale] = {}
    byLocale[locale][namespace] = takeDefault(mod)
  }

  return byLocale
}
