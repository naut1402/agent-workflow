import { ref, type Ref } from 'vue'
import { apiFetch } from '../http/client'
import { getLocaleRegistry, registerLocale, i18n } from '../plugins/i18n'
import {
  DEFAULT_LOCALE,
  resolveLocale,
  type AppSettings,
  type LocalePreference,
} from '../configs/appSettings'

/** Store cache-first (localStorage) cho chuỗi dịch nạp từ `GET /api/i18n/*`. */

export const I18N_CACHE_KEY = 'dev-dashboard-i18n-cache'

type CacheEntry = { etag: string; messages: Record<string, unknown> }
type CacheShape = Record<string, CacheEntry>

/** Locale đã nạp vào vue-i18n trong phiên này. */
const loadedLocales: Ref<string[]> = ref([])
const pending: Ref<string | null> = ref(null)
const lastError: Ref<string | null> = ref(null)
const manifestError: Ref<string | null> = ref(null)
const inflight = new Map<string, Promise<boolean>>()

function readCache(): CacheShape {
  try {
    const raw = localStorage.getItem(I18N_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as CacheShape
  } catch {
    return {}
  }
}

function readCacheEntry(locale: string): CacheEntry | null {
  const hit = readCache()[locale]
  if (!hit || typeof hit !== 'object') return null
  const messages = (hit as CacheEntry).messages
  if (!messages || typeof messages !== 'object' || Array.isArray(messages)) return null
  return { etag: typeof hit.etag === 'string' ? hit.etag : '', messages }
}

function writeCache(locale: string, entry: CacheEntry): void {
  try {
    const next = readCache()
    next[locale] = entry
    localStorage.setItem(I18N_CACHE_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}

function markLoaded(locale: string): void {
  if (!loadedLocales.value.includes(locale)) {
    loadedLocales.value = [...loadedLocales.value, locale]
  }
}

function hasMessages(locale: string): boolean {
  try {
    const m = i18n.global.getLocaleMessage(locale) as Record<string, unknown> | undefined
    return !!m && Object.keys(m).length > 0
  } catch {
    return false
  }
}

/** Nạp đồng bộ messages từ cache vào vue-i18n; `false` khi không có cache. */
export function primeFromCache(locale: string): boolean {
  const hit = readCacheEntry(locale)
  if (!hit) return false
  registerLocale(locale, hit.messages)
  markLoaded(locale)
  return true
}

export type EnsureLocaleOptions = {
  /** Bỏ qua ETag đã lưu và nạp lại từ đầu. */
  force?: boolean
}

/** Nạp locale vào vue-i18n, không ném; `true` khi vue-i18n có messages của locale đó. */
export async function ensureLocale(
  locale: string,
  opts: EnsureLocaleOptions = {},
): Promise<boolean> {
  const existing = inflight.get(locale)
  if (existing) return existing

  const cached = opts.force ? null : readCacheEntry(locale)
  if (cached) primeFromCache(locale)

  const task = (async (): Promise<boolean> => {
    pending.value = locale
    lastError.value = null
    try {
      const headers: Record<string, string> = {}
      if (cached?.etag) headers['If-None-Match'] = cached.etag
      const res = await apiFetch(`/api/i18n/${locale}`, { headers })

      if (res.status === 304) return true
      if (!res.ok) throw new Error(`i18n ${res.status}`)

      const etag = res.headers.get('ETag') ?? ''
      const body = await res.json()
      const messages = (body?.messages ?? {}) as Record<string, unknown>
      registerLocale(locale, messages)
      writeCache(locale, { etag, messages })
      markLoaded(locale)
      return true
    } catch (err) {
      const ok = hasMessages(locale)
      if (ok) markLoaded(locale)
      else lastError.value = err instanceof Error ? err.message : String(err)
      return ok
    } finally {
      pending.value = null
      inflight.delete(locale)
    }
  })()

  inflight.set(locale, task)
  return task
}

/** Bổ sung mã locale từ manifest server vào registry; lỗi thì giữ registry hiện tại. */
export async function ensureManifest(): Promise<void> {
  try {
    const res = await apiFetch('/api/i18n/manifest')
    if (!res.ok) throw new Error(`i18n manifest ${res.status}`)
    const body = await res.json()
    const locales = Array.isArray(body?.locales) ? body.locales : []
    for (const code of locales) {
      if (typeof code === 'string' && code) registerLocale(code, {})
    }
    manifestError.value = null
  } catch (err) {
    manifestError.value = err instanceof Error ? err.message : String(err)
  }
}

/**
 * Locale dùng để mount app. Có cache thì trả ngay và revalidate nền; không có thì chờ
 * một lượt nạp, hỏng thì rơi về locale mặc định.
 */
export async function initLocale(
  settings: AppSettings | null | undefined,
): Promise<LocalePreference> {
  const locale = resolveLocale(settings)

  if (primeFromCache(locale)) {
    void ensureManifest()
    void ensureLocale(locale)
    return locale
  }

  const ok = await ensureLocale(locale)
  void ensureManifest()
  if (!ok && locale !== DEFAULT_LOCALE) {
    await ensureLocale(DEFAULT_LOCALE)
    return DEFAULT_LOCALE
  }
  return locale
}

export function useLocaleMessages() {
  return {
    loadedLocales,
    pending,
    lastError,
    manifestError,
    primeFromCache,
    ensureLocale,
    ensureManifest,
    initLocale,
    registry: getLocaleRegistry(),
  }
}
