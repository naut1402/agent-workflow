import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  i18n,
  t,
  setI18nLocale,
  registerLocale,
  getLocaleRegistry,
  supportedLocales,
  DEFAULT_LOCALE,
} from '@/frontend/plugins/i18n/index'
import { useLocale } from '@/frontend/composables/useLocale'
import { useLocaleMessages, I18N_CACHE_KEY } from '@/frontend/composables/useLocaleMessages'
import { useAppSettings, STORAGE_KEY } from '@/frontend/composables/useAppSettings'
import { resolveLocale } from '../../../../../src/frontend/configs/appSettings'

/**
 * Nhóm F (plugin + registry) và nhóm H (`useLocale.setLocale`) của `test-spec.md`.
 *
 * Registry là state singleton ở module scope, nên THỨ TỰ describe trong file này có ý
 * nghĩa: ca chốt trạng thái khởi tạo chạy trước mọi ca `registerLocale`. Mạng được
 * chặn ở tầng global `fetch` — `apiFetch` thật vẫn chạy, nên header gửi đi là header
 * thật chứ không phải header của mock.
 */

type FetchCall = { url: string; init: RequestInit | undefined }

let calls: FetchCall[]

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return handler(String(input), init)
    }),
  )
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
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

describe('i18n foundation — bề mặt build-time', () => {
  it('TC-F02: `DEFAULT_LOCALE` là vi và locale khởi tạo là vi', () => {
    expect(DEFAULT_LOCALE).toBe('vi')
    expect(supportedLocales()).toEqual(['vi', 'en'])
    expect(i18n.global.locale.value).toBe('vi')
  })

  it('resolveLocale: missing/invalid → vi, explicit en → en', () => {
    expect(resolveLocale(null)).toBe('vi')
    expect(resolveLocale({})).toBe('vi')
    expect(resolveLocale({ locale: '' })).toBe('vi')
    expect(resolveLocale({ locale: 'en' })).toBe('en')
    // Không truyền `allowed` (boot, manifest chưa về) → chỉ kiểm non-empty.
    expect(resolveLocale({ locale: 'ja' })).toBe('ja')
    // Có `allowed` → mã không nằm trong danh sách rơi về mặc định.
    expect(resolveLocale({ locale: 'ja' }, ['vi', 'en'])).toBe('vi')
    expect(resolveLocale({ locale: 'ja' }, ['vi', 'en', 'ja'])).toBe('ja')
  })

  it('TC-F06: t() đổi theo locale đang active', () => {
    expect(t('common.modes.logs')).toBe('Nhật ký')
    setI18nLocale('en')
    expect(t('common.modes.logs')).toBe('Logs')
  })

  it('TC-F06: interpolation có tên chạy đúng', () => {
    expect(t('common.sidebar.version', { version: '1.2.3' })).toBe('Phiên bản 1.2.3')
  })
})

describe('registry mở rộng lúc chạy (nhóm F)', () => {
  it('TC-F01: `supportedLocales()` đọc tại thời điểm gọi, không phải hằng build-time (G-C13)', () => {
    const before = supportedLocales()
    expect(before).toContain('vi')
    expect(before).toContain('en')
    expect(before).not.toContain('ja')

    registerLocale('ja', { common: { language: { names: { ja: '日本語' } } } })

    expect(supportedLocales()).toContain('ja')
    // Và `before` là BẢN SAO — snapshot cũ không bị mutate dưới chân caller.
    expect(before).not.toContain('ja')
  })

  it('TC-F01b: `supportedLocales()` trả bản sao — caller 🚫 không mutate được registry', () => {
    const copy = supportedLocales() as string[]
    copy.push('zz')
    expect(supportedLocales()).not.toContain('zz')
    expect(getLocaleRegistry().locales).not.toContain('zz')
  })

  it('TC-F03: thứ tự ổn định — vi, en, rồi locale thêm sau', () => {
    registerLocale('ja', { common: { language: { names: { ja: '日本語' } } } })
    const locales = supportedLocales()
    expect(locales[0]).toBe('vi')
    expect(locales[1]).toBe('en')
    expect(locales.indexOf('ja')).toBeGreaterThan(1)
  })

  it('TC-F04: `registerLocale` DEEP-MERGE, không thay thế (G-C16)', () => {
    const buildTimeKeys = Object.keys(
      i18n.global.getLocaleMessage('en') as Record<string, unknown>,
    )

    registerLocale('en', { common: { x: '1' } })
    registerLocale('en', { common: { y: '2' } })

    const common = (i18n.global.getLocaleMessage('en') as Record<string, Record<string, unknown>>)
      .common
    expect(common.x).toBe('1')
    expect(common.y).toBe('2')
    // Khoá build-time của `common` KHÔNG mất…
    expect(common.language).toBeDefined()
    expect(common.modes).toBeDefined()
    // …và không namespace nào biến mất.
    for (const ns of buildTimeKeys) {
      expect(Object.keys(i18n.global.getLocaleMessage('en') as object)).toContain(ns)
    }
  })

  it('TC-F05: gọi 2 lần cùng locale 🚫 không nhân đôi entry registry', () => {
    registerLocale('ja', { common: { a: '1' } })
    registerLocale('ja', { common: { b: '2' } })
    expect(supportedLocales().filter((l) => l === 'ja')).toEqual(['ja'])
  })

  it('TC-F01c: locale mới dùng được ngay sau khi đăng ký', () => {
    registerLocale('ja', { common: { modes: { logs: 'ログ' } } })
    expect(getLocaleRegistry().locales).toContain('ja')
    setI18nLocale('ja')
    expect(t('common.modes.logs')).toBe('ログ')
    setI18nLocale('vi')
  })

  it('TC-F06: khoá thiếu ở locale đang dùng rơi về fallback vi', () => {
    registerLocale('xx', { common: { modes: { logs: 'XX' } } })
    setI18nLocale('xx')
    expect(t('common.sidebar.version', { version: '1.2.3' })).toBe('Phiên bản 1.2.3')
    setI18nLocale('vi')
  })
})

describe('useLocale.setLocale (nhóm H)', () => {
  it('TC-H01: chữ ký async — trả Promise', () => {
    stubFetch(() => jsonResponse({ locale: 'en', messages: {} }))
    const { setLocale } = useLocale()
    const result = setLocale('en')
    expect(typeof (result as Promise<void>).then).toBe('function')
    return result
  })

  it('TC-H02: locale ĐÃ nạp ⇒ đổi ngay, 0 request (tiêu chí 2 của request.md)', async () => {
    stubFetch(() => {
      throw new Error('🚫 không được chạm mạng khi locale đã nạp')
    })
    const store = useLocaleMessages()
    store.loadedLocales.value = ['en']
    store.lastError.value = 'i18n 500'

    const { locale, setLocale } = useLocale()
    await setLocale('en')

    expect(calls).toEqual([])
    expect(locale.value).toBe('en')
    expect(i18n.global.locale.value).toBe('en')
    // Đổi thành công ⇒ lỗi của lượt trước 🚫 không còn treo ở Settings.
    expect(store.lastError.value).toBeNull()
  })

  it('TC-H03: locale chưa nạp, nạp OK ⇒ đổi locale + persist preference', async () => {
    stubFetch(() =>
      jsonResponse(
        { locale: 'en', messages: { common: { modes: { logs: 'Logs (từ API)' } } } },
        { headers: { ETag: '"e1"', 'Content-Type': 'application/json' } },
      ),
    )

    const { locale, setLocale } = useLocale()
    await setLocale('en')

    expect(calls.map((c) => c.url)).toEqual(['/api/i18n/en'])
    expect(locale.value).toBe('en')
    expect(i18n.global.locale.value).toBe('en')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).locale).toBe('en')
    expect(t('common.modes.logs')).toBe('Logs (từ API)')
  })

  it('TC-H04: nạp thất bại ⇒ GIỮ locale cũ, 🚫 không persist', async () => {
    // `de` là locale KHÔNG có messages build-time — đúng điều kiện của ca: API chết và
    // vue-i18n cũng không có gì để rơi về, nên đổi locale là đổi sang màn không có chữ.
    stubFetch(() => new Response('boom', { status: 500 }))

    const { locale, setLocale, lastError } = useLocale()
    await setLocale('de')

    expect(locale.value).toBe('vi')
    expect(i18n.global.locale.value).toBe('vi')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').locale).toBeUndefined()
    expect(lastError.value).not.toBeNull()
  })

  it('TC-H05: gọi với locale đang dùng ⇒ no-op, 0 request, 🚫 không ghi localStorage', async () => {
    stubFetch(() => {
      throw new Error('🚫 không được chạm mạng')
    })
    const { setLocale } = useLocale()
    await setLocale('vi')

    expect(calls).toEqual([])
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('TC-H07: gọi 2 lần liên tiếp cùng locale ⇒ như gọi 1 lần, 🚫 không nhân đôi `loadedLocales`', async () => {
    stubFetch(() =>
      jsonResponse({ locale: 'en', messages: { common: { ok: 'OK' } } }, {
        headers: { ETag: '"e1"', 'Content-Type': 'application/json' },
      }),
    )

    const { locale, setLocale } = useLocale()
    await setLocale('en')
    await setLocale('en')

    expect(locale.value).toBe('en')
    expect(useLocaleMessages().loadedLocales.value.filter((l) => l === 'en')).toEqual(['en'])
    expect(calls.map((c) => c.url)).toEqual(['/api/i18n/en'])
  })

  it('TC-H06: vi→en→vi rất nhanh ⇒ dừng ở lựa chọn CUỐI của người dùng (G-C12)', async () => {
    stubFetch(() =>
      jsonResponse({ locale: 'en', messages: { common: { ok: 'OK' } } }, {
        headers: { ETag: '"e1"', 'Content-Type': 'application/json' },
      }),
    )

    const { locale, setLocale } = useLocale()
    // 🚫 Không await giữa chừng — đúng kiểu người dùng bấm hai lần liên tiếp.
    const p1 = setLocale('en')
    const p2 = setLocale('vi')
    await Promise.all([p1, p2])

    // `design.md` §4.4 G-C12: "Locale cuối cùng người dùng chọn là locale được persist."
    expect(locale.value).toBe('vi')
    expect(i18n.global.locale.value).toBe('vi')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').locale ?? 'vi').toBe('vi')
    // Lượt quay về `vi` 🚫 không chạm mạng (vi luôn có sẵn build-time).
    expect(calls.map((c) => c.url)).toEqual(['/api/i18n/en'])
  })

  it('TC-H03b: cache của store tách khỏi settings — hai key localStorage riêng', async () => {
    stubFetch(() =>
      jsonResponse({ locale: 'en', messages: { common: { ok: 'OK' } } }, {
        headers: { ETag: '"e1"', 'Content-Type': 'application/json' },
      }),
    )
    const { setLocale } = useLocale()
    await setLocale('en')

    const settings = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(Object.keys(settings)).toEqual(['locale'])
    const cache = JSON.parse(localStorage.getItem(I18N_CACHE_KEY)!)
    expect(cache.en.etag).toBe('"e1"')
    // Messages 🚫 không được lẫn vào key settings — đó là lý do cache có key riêng.
    expect(JSON.stringify(settings)).not.toContain('messages')
  })
})
