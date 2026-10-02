import { ref, type Ref } from 'vue'
import { apiFetch } from '../http/client'
import { getLocaleRegistry, registerLocale, i18n } from '../plugins/i18n'
import {
  DEFAULT_LOCALE,
  resolveLocale,
  type AppSettings,
  type LocalePreference,
} from '../configs/appSettings'

/**
 * Store cache-first cho chuỗi dịch nạp từ `GET /api/i18n/*`.
 *
 * Theo đúng khuôn `useAppSettings.ts`: state ở module scope (singleton xuyên caller),
 * composable chỉ trả bề mặt. Cache nằm ở key RIÊNG — payload vài trăm KB, trộn chung
 * với preferences thì mỗi lần `update()` lại ghi lại cả đống messages.
 */

export const I18N_CACHE_KEY = 'dev-dashboard-i18n-cache'

type CacheEntry = { etag: string; messages: Record<string, unknown> }
type CacheShape = Record<string, CacheEntry>

/** Locale đã bơm vào vue-i18n trong phiên này. */
const loadedLocales: Ref<string[]> = ref([])
/** Locale đang có request bay ra (UI hiện trạng thái chờ). */
const pending: Ref<string | null> = ref(null)
const lastError: Ref<string | null> = ref(null)
/** Chống fetch trùng khi nhiều component cùng gọi một locale. */
const inflight = new Map<string, Promise<boolean>>()

function readCache(): CacheShape {
  try {
    const raw = localStorage.getItem(I18N_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as CacheShape
  } catch {
    // Cache hỏng / localStorage ném (private mode) → coi như chưa có cache.
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
    /* ignore — quota / private mode. Mất cache chỉ làm boot sau chậm hơn. */
  }
}

function markLoaded(locale: string): void {
  if (!loadedLocales.value.includes(locale)) {
    loadedLocales.value = [...loadedLocales.value, locale]
  }
}

/** vue-i18n đã có messages của locale này chưa (kể cả bản build-time). */
function hasMessages(locale: string): boolean {
  try {
    const m = i18n.global.getLocaleMessage(locale) as Record<string, unknown> | undefined
    return !!m && Object.keys(m).length > 0
  } catch {
    return false
  }
}

/**
 * Bơm messages từ cache vào vue-i18n — ĐỒNG BỘ, gọi được trước mount.
 * `false` khi không có cache dùng được (gọi `ensureLocale` để nạp qua mạng).
 */
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

/**
 * Nạp locale vào vue-i18n. Trả `true` nếu SAU khi xong vue-i18n có messages của
 * locale đó — kể cả khi đường mạng hỏng mà bản build-time đã đủ dùng.
 * KHÔNG ném: lỗi nạp chuỗi dịch không được phép làm chết luồng gọi.
 */
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
    try {
      // apiFetch (không apiGet): cần đọc header ETag và xử lý 304 — 304 không có body
      // và apiGet coi mọi `!ok` là lỗi.
      const headers: Record<string, string> = {}
      if (cached?.etag) headers['If-None-Match'] = cached.etag
      const res = await apiFetch(`/api/i18n/${locale}`, { headers })

      if (res.status === 304) return true // cache còn đúng, không đụng gì
      if (!res.ok) throw new Error(`i18n ${res.status}`)

      const etag = res.headers.get('ETag') ?? ''
      const body = await res.json()
      const messages = (body?.messages ?? {}) as Record<string, unknown>
      registerLocale(locale, messages)
      writeCache(locale, { etag, messages })
      markLoaded(locale)
      lastError.value = null
      return true
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
      // Fallback: bản build-time vẫn nằm trong vue-i18n (loadLocaleMessages chạy ở
      // module scope) → locale có sẵn thì vẫn có chữ, chỉ là chữ cũ.
      const ok = hasMessages(locale)
      if (ok) markLoaded(locale)
      return ok
    } finally {
      pending.value = null
      inflight.delete(locale)
    }
  })()

  inflight.set(locale, task)
  return task
}

/**
 * Đồng bộ danh sách locale với manifest server. Lỗi thì GIỮ registry hiện tại —
 * mất manifest không được phép làm biến mất ngôn ngữ đang chọn được.
 */
export async function ensureManifest(): Promise<void> {
  try {
    const res = await apiFetch('/api/i18n/manifest')
    if (!res.ok) throw new Error(`i18n manifest ${res.status}`)
    const body = await res.json()
    const locales = Array.isArray(body?.locales) ? body.locales : []
    for (const code of locales) {
      // `registerLocale(code, {})` chỉ đưa mã vào registry (deep-merge với {} là no-op),
      // đủ để SettingsDialog thấy ngôn ngữ mới mà chưa cần tải messages của nó.
      if (typeof code === 'string' && code) registerLocale(code, {})
    }
  } catch (err) {
    lastError.value = err instanceof Error ? err.message : String(err)
  }
}

/**
 * Locale dùng để mount app. Tách khỏi `main.ts` để luồng cache-first — tiêu chí 2 của
 * request — có bề mặt test được.
 *
 * Cache hit thì KHÔNG chặn: mount ngay bằng chữ trong cache rồi revalidate nền.
 * Cache rỗng mới chờ đúng một lượt; lượt đó hỏng thì rơi về locale mặc định.
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

/** Bề mặt store cho component (singleton xuyên caller). */
export function useLocaleMessages() {
  return {
    loadedLocales,
    pending,
    lastError,
    primeFromCache,
    ensureLocale,
    ensureManifest,
    initLocale,
    registry: getLocaleRegistry(),
  }
}
