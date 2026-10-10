import * as nodeCrypto from 'node:crypto'
import {
  dirnameFromImportMeta,
  readTextFile,
  resolvePath,
  resolvePathUnder,
  safeReadDir,
  statSafe,
} from '../../../backend/lib/fileHelper.js'
import { loadYaml } from '../../../backend/lib/yamlLib.js'

/** Bản dịch repo `src/shared/locales/<locale>/<namespace>.yaml`; overlay `<dataRoot>/locales/` deep-merge đè lên. */
export const REPO_LOCALES = resolvePath(
  dirnameFromImportMeta(import.meta.url),
  '../../../shared/locales',
)

const PINNED_ORDER = ['vi', 'en']

export const DEFAULT_LOCALE = 'vi'

const LOCALE_CODE = /^[a-z]{2}(-[A-Z]{2})?$/

export function isSafeLocaleCode(locale: string): boolean {
  return LOCALE_CODE.test(locale)
}

export type LocaleBundle = Record<string, Record<string, unknown>>

function overlayDir(defaultRoot: string | null): string | null {
  return defaultRoot ? resolvePathUnder(defaultRoot, 'locales') : null
}

function orderLocales(codes: string[]): string[] {
  const rest = codes.filter((c) => !PINNED_ORDER.includes(c)).sort()
  return [...PINNED_ORDER.filter((c) => codes.includes(c)), ...rest]
}

/** Thư mục locale có ít nhất một file namespace `.yaml`. */
async function readLocaleDirNames(dir: string | null): Promise<string[]> {
  if (!dir) return []
  const names: string[] = []
  for (const entry of await safeReadDir(dir)) {
    if (!entry.isDirectory() || !isSafeLocaleCode(entry.name)) continue
    const localeDir = resolvePathUnder(dir, entry.name)
    if (!localeDir) continue
    const files = await safeReadDir(localeDir)
    if (files.some((f) => f.isFile() && f.name.endsWith('.yaml'))) names.push(entry.name)
  }
  return names
}

export async function listLocales(
  defaultRoot: string | null,
  baseDir: string = REPO_LOCALES,
): Promise<string[]> {
  const repo = await readLocaleDirNames(baseDir)
  const over = await readLocaleDirNames(overlayDir(defaultRoot))
  return orderLocales([...new Set([...repo, ...over])])
}

/** `null` khi thư mục không có file `.yaml` nào; file hỏng / không phải object bị bỏ qua. */
async function readNamespaceDir(dir: string | null): Promise<LocaleBundle | null> {
  if (!dir) return null
  const entries = (await safeReadDir(dir)).filter((e) => e.isFile() && e.name.endsWith('.yaml'))
  if (entries.length === 0) return null
  const out: LocaleBundle = {}
  for (const entry of entries) {
    const namespace = entry.name.slice(0, -'.yaml'.length)
    const file = resolvePathUnder(dir, entry.name)
    if (!file) continue
    try {
      const parsed = loadYaml(await readTextFile(file))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        out[namespace] = parsed as Record<string, unknown>
      } else {
        console.warn(`[i18n] bỏ qua namespace không phải object: ${file}`)
      }
    } catch (err) {
      console.warn(`[i18n] bỏ qua file YAML hỏng: ${file}`, err)
    }
  }
  return out
}

function deepMerge(
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
      ? deepMerge(prev as Record<string, unknown>, v as Record<string, unknown>)
      : v
  }
  return out
}

/** `null` khi mã locale không hợp lệ hoặc locale không có ở cả repo lẫn overlay. */
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
  return deepMerge(base ?? {}, over ?? {}) as LocaleBundle
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
  return `{${entries.join(',')}}`
}

export function localeEtag(bundle: unknown): string {
  const hash = nodeCrypto.createHash('sha1').update(stableStringify(bundle)).digest('hex')
  return `"${hash}"`
}

export type LocaleBundleEntry = { bundle: LocaleBundle; etag: string }

const bundleMemo = new Map<string, { stamp: string; entry: LocaleBundleEntry }>()

/** Dấu thay đổi của một thư mục locale: mtime thư mục + tên/mtime/size từng file `.yaml`. */
async function dirStamp(dir: string | null): Promise<string> {
  if (!dir) return '-'
  const info = await statSafe(dir)
  if (!info.exists) return '-'
  const parts = [String(info.mtime)]
  const files = (await safeReadDir(dir))
    .filter((e) => e.isFile() && e.name.endsWith('.yaml'))
    .map((e) => e.name)
    .sort()
  for (const name of files) {
    const file = resolvePathUnder(dir, name)
    const s = file ? await statSafe(file) : null
    parts.push(`${name}:${s?.mtime ?? '-'}:${s?.size ?? 0}`)
  }
  return parts.join('|')
}

/** `readLocaleBundle` kèm ETag, memo trong tiến trình; đọc lại khi file repo/overlay đổi mtime. */
export async function readLocaleBundleCached(
  locale: string,
  defaultRoot: string | null,
  baseDir: string = REPO_LOCALES,
): Promise<LocaleBundleEntry | null> {
  if (!isSafeLocaleCode(locale)) return null
  const overlay = overlayDir(defaultRoot)
  const stamp = [
    await dirStamp(resolvePathUnder(baseDir, locale)),
    await dirStamp(overlay ? resolvePathUnder(overlay, locale) : null),
  ].join('#')
  const key = JSON.stringify([baseDir, defaultRoot, locale])
  const hit = bundleMemo.get(key)
  if (hit && hit.stamp === stamp) return hit.entry

  const bundle = await readLocaleBundle(locale, defaultRoot, baseDir)
  if (!bundle) {
    bundleMemo.delete(key)
    return null
  }
  const entry = { bundle, etag: localeEtag(bundle) }
  bundleMemo.set(key, { stamp, entry })
  return entry
}
