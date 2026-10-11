import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n, setI18nLocale, t } from '@/frontend/plugins/i18n'
import {
  I18N_CACHE_KEY,
  initLocale,
  useLocaleMessages,
} from '@/frontend/composables/useLocaleMessages'
import { useAppSettings } from '@/frontend/composables/useAppSettings'

/**
 * Nhóm N của `test-spec.md` — luồng boot.
 *
 * Q3 §7 đã chốt: logic boot tách khỏi `main.ts` thành `initLocale(settings)`, nên luồng
 * cache-first (tiêu chí 2 của `request.md`) có bề mặt tự động thay vì chỉ còn 3 ca kiểm
 * tay. `main.ts` giờ chỉ còn `await initLocale(settings.value)`.
 *
 * Bất biến quan trọng nhất ở đây: **cache hit KHÔNG được chặn boot**. Ca TC-N01 chốt nó
 * bằng một `fetch` KHÔNG BAO GIỜ resolve — hàm mà await request thì ca treo, không phải
 * đỏ vì một assert mềm.
 */

let calls: string[]

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return handler(String(input))
    }),
  )
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function reset() {
  calls = []
  localStorage.clear()
  useAppSettings().load()
  setI18nLocale('vi')
  const store = useLocaleMessages()
  store.loadedLocales.value = []
  store.lastError.value = null
  store.pending.value = null
  vi.unstubAllGlobals()
}

beforeEach(reset)
afterEach(reset)

describe('initLocale — cache-first, không chặn boot', () => {
  it('TC-N01: cache hit ⇒ trả về mà KHÔNG chờ request nào; vẫn revalidate nền', async () => {
    // Locale riêng cho ca này: request treo vĩnh viễn sẽ ghim entry `inflight` của mã
    // đó lại, và `inflight` là state module-scope dùng chung cả file.
    localStorage.setItem(
      I18N_CACHE_KEY,
      JSON.stringify({ pt: { etag: '"abc"', messages: { common: { ok: 'TU-CACHE' } } } }),
    )
    // Request không bao giờ xong: hàm nào await nó thì ca này TREO, không "đỏ nhẹ".
    stubFetch(() => new Promise<Response>(() => {}))

    const locale = await initLocale({ locale: 'pt' })

    expect(locale).toBe('pt')
    // Messages của cache đã vào vue-i18n ngay, app mount được với chữ thật.
    setI18nLocale('pt')
    expect(t('common.ok')).toBe('TU-CACHE')
    setI18nLocale('vi')
    // Revalidate vẫn được châm ngòi (bundle + manifest), chỉ là không chờ.
    expect(calls).toContain('/api/i18n/pt')
    expect(calls).toContain('/api/i18n/manifest')
  })

  it('TC-N02: cache rỗng ⇒ chờ đúng một lượt, messages đã có TRƯỚC khi trả', async () => {
    stubFetch((url) =>
      url.includes('manifest')
        ? jsonResponse({ locales: ['vi', 'en'], defaultLocale: 'vi' })
        : jsonResponse({ locale: 'en', messages: { common: { ok: 'TU-API' } } }, { ETag: '"e1"' }),
    )

    const locale = await initLocale({ locale: 'en' })

    expect(locale).toBe('en')
    setI18nLocale('en')
    expect(t('common.ok')).toBe('TU-API')
    expect(useLocaleMessages().loadedLocales.value).toContain('en')
    expect(calls).toContain('/api/i18n/en')
  })

  it('TC-N03: API chết + cache rỗng ⇒ 🚫 không ném, 🚫 không treo, app vẫn có chữ', async () => {
    stubFetch(() => Promise.reject(new Error('network')))

    const locale = await initLocale({ locale: 'vi' })

    expect(locale).toBe('vi')
    // Bản build-time vẫn nằm trong vue-i18n → màn hình có chữ, không trắng.
    expect(Object.keys(i18n.global.getLocaleMessage('vi') as object).length).toBeGreaterThan(0)
    expect(t('common.modes.logs')).toBe('Nhật ký')
  })

  it('TC-N03b: settings null/undefined ⇒ rơi về locale mặc định, không ném', async () => {
    stubFetch(() => Promise.reject(new Error('network')))
    expect(await initLocale(null)).toBe('vi')
    expect(await initLocale(undefined)).toBe('vi')
  })

  it('TC-N04: locale đã lưu không còn phục vụ được ⇒ rơi về mặc định (G-C14)', async () => {
    stubFetch((url) => {
      if (url.includes('manifest')) {
        return jsonResponse({ locales: ['vi', 'en'], defaultLocale: 'vi' })
      }
      if (url.endsWith('/ja')) return new Response(JSON.stringify({ error: 'unknown locale' }), { status: 404 })
      return jsonResponse({ locale: 'vi', messages: {} })
    })

    const locale = await initLocale({ locale: 'ja' })

    expect(locale).toBe('vi')
    expect(calls).toContain('/api/i18n/ja')
    expect(calls).toContain('/api/i18n/vi')
  })

  it('TC-N02b: 304 lúc boot ⇒ vẫn trả về locale đã chọn, cache giữ nguyên', async () => {
    const cache = { en: { etag: '"abc"', messages: { common: { ok: 'TU-CACHE' } } } }
    localStorage.setItem(I18N_CACHE_KEY, JSON.stringify(cache))
    stubFetch((url) =>
      url.includes('manifest')
        ? jsonResponse({ locales: ['vi', 'en'], defaultLocale: 'vi' })
        : new Response(null, { status: 304 }),
    )

    expect(await initLocale({ locale: 'en' })).toBe('en')
    // Đợi lượt revalidate nền xong rồi mới chốt cache — nếu không, ca này đo lúc nửa chừng.
    await new Promise((r) => setTimeout(r, 0))
    expect(JSON.parse(localStorage.getItem(I18N_CACHE_KEY)!)).toEqual(cache)
  })
})
