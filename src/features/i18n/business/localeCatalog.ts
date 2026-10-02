import * as nodeCrypto from 'node:crypto'
import {
  dirnameFromImportMeta,
  readTextFile,
  resolvePath,
  resolvePathUnder,
  safeReadDir,
} from '../../../backend/lib/fileHelper.js'

/**
 * Nguồn sự thật của chuỗi dịch: JSON ở `src/shared/locales/<locale>/<namespace>.json`,
 * cộng overlay tuỳ chọn ở `<dataRoot>/locales/` deep-merge đè lên.
 *
 * Đọc filesystem theo nguyên tắc phòng thủ: thư mục thiếu → rỗng, một file JSON hỏng
 * → bỏ qua đúng file đó chứ không làm chết cả locale.
 */

/**
 * Gốc bản dịch đi theo repo. `standalone.ts` chạy thẳng từ source
 * (`bun src/backend/standalone.ts`) và dev mode chạy qua vite plugin cũng từ source,
 * nên đường dẫn này hợp lệ ở cả hai môi trường.
 */
export const REPO_LOCALES = resolvePath(
  dirnameFromImportMeta(import.meta.url),
  '../../../shared/locales',
)

/** Thứ tự ưu tiên khi hiển thị — giữ đúng thứ tự hiện tại của `localeRegistry`. */
const PINNED_ORDER = ['vi', 'en']

export const DEFAULT_LOCALE = 'vi'

/** Mã locale hợp lệ: `vi`, `en`, `pt-BR`. Chặn traversal trước khi chạm đĩa. */
const LOCALE_CODE = /^[a-z]{2}(-[A-Z]{2})?$/

export function isSafeLocaleCode(locale: string): boolean {
  return LOCALE_CODE.test(locale)
}

export type LocaleBundle = Record<string, Record<string, unknown>>

/** Overlay nằm trong data root mặc định, KHÔNG theo `?project=` — i18n là global. */
function overlayDir(defaultRoot: string | null): string | null {
  return defaultRoot ? resolvePathUnder(defaultRoot, 'locales') : null
}

/** `vi` trước, `en` sau, phần còn lại alphabet — UI không nhảy thứ tự khi thêm locale. */
function orderLocales(codes: string[]): string[] {
  const rest = codes.filter((c) => !PINNED_ORDER.includes(c)).sort()
  return [...PINNED_ORDER.filter((c) => codes.includes(c)), ...rest]
}

async function readLocaleDirNames(dir: string | null): Promise<string[]> {
  if (!dir) return []
  const entries = await safeReadDir(dir)
  return entries.filter((e) => e.isDirectory()).map((e) => e.name)
}

/** Danh sách locale = hợp của tên thư mục ở hai tầng (repo + overlay). */
export async function listLocales(
  defaultRoot: string | null,
  baseDir: string = REPO_LOCALES,
): Promise<string[]> {
  const repo = await readLocaleDirNames(baseDir)
  const over = await readLocaleDirNames(overlayDir(defaultRoot))
  return orderLocales([...new Set([...repo, ...over])].filter(isSafeLocaleCode))
}

/**
 * Mỗi `*.json` trong thư mục là một namespace.
 * Trả `null` khi thư mục không tồn tại — phân biệt với "có thư mục nhưng rỗng".
 */
async function readNamespaceDir(dir: string | null): Promise<LocaleBundle | null> {
  if (!dir) return null
  const entries = await safeReadDir(dir)
  if (entries.length === 0) return null
  const out: LocaleBundle = {}
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const namespace = entry.name.slice(0, -'.json'.length)
    const file = resolvePathUnder(dir, entry.name)
    if (!file) continue
    try {
      const parsed = JSON.parse(await readTextFile(file))
      // Một namespace phải là object; mảng/scalar là dữ liệu sai, bỏ qua như file hỏng.
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        out[namespace] = parsed as Record<string, unknown>
      } else {
        console.warn(`[i18n] bỏ qua namespace không phải object: ${file}`)
      }
    } catch (err) {
      // Một file hỏng KHÔNG được làm chết cả locale (G-C7).
      console.warn(`[i18n] bỏ qua file JSON hỏng: ${file}`, err)
    }
  }
  return out
}

function deepMergeJson(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    const prev = base[k]
    const bothPlainObjects =
      v != null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      prev != null &&
      typeof prev === 'object' &&
      !Array.isArray(prev)
    out[k] = bothPlainObjects
      ? deepMergeJson(prev as Record<string, unknown>, v as Record<string, unknown>)
      : v
  }
  return out
}

/**
 * Bundle của một locale: `{ namespace: { ...messages } }`, overlay đè lên repo.
 * `null` khi locale không tồn tại ở cả hai tầng hoặc mã locale không hợp lệ.
 */
export async function readLocaleBundle(
  locale: string,
  defaultRoot: string | null,
  baseDir: string = REPO_LOCALES,
): Promise<LocaleBundle | null> {
  if (!isSafeLocaleCode(locale)) return null
  const overlay = overlayDir(defaultRoot)
  const base = await readNamespaceDir(resolvePathUnder(baseDir, locale))
  const over = overlay ? await readNamespaceDir(resolvePathUnder(overlay, locale)) : null
  if (!base && !over) return null
  return deepMergeJson(base ?? {}, over ?? {}) as LocaleBundle
}

/** `JSON.stringify` với key đã sort → cùng nội dung luôn ra cùng chuỗi. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
  return `{${entries.join(',')}}`
}

/**
 * ETag = hash nội dung ĐÃ merge. Không phụ thuộc thứ tự `Object.keys` của lần đọc
 * thư mục, nên ổn định giữa các lần gọi và giữa các instance app (G-C15).
 */
export function localeEtag(bundle: unknown): string {
  const hash = nodeCrypto.createHash('sha1').update(stableStringify(bundle)).digest('hex')
  return `"${hash}"`
}
