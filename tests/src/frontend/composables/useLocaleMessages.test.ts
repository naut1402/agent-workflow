import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n, setI18nLocale, supportedLocales, t } from '@/frontend/plugins/i18n'
import {
  I18N_CACHE_KEY,
  LOCALE_FETCH_TIMEOUT_MS,
  ensureLocale,
  ensureManifest,
  primeFromCache,
  useLocaleMessages,
} from '@/frontend/composables/useLocaleMessages'
import { STORAGE_KEY, useAppSettings } from '@/frontend/composables/useAppSettings'

/**
 * Nhóm G của `test-spec.md` — store cache-first `useLocaleMessages`.
 *
 * Đây là nơi tiêu chí 2 của `request.md` ("đổi locale thì UI đổi nhanh") thực sự sống:
 * cache mount được ngay trong lượt ĐỒNG BỘ, 304 không tải lại, và một lỗi mạng 🚫
 * không bao giờ được ném ra ngoài làm chết luồng gọi.
 *
 * Mạng chặn ở tầng global `fetch` — `apiFetch` thật vẫn chạy, nên header `If-None-Match`
 * quan sát được ở đây là header thật đi ra dây, không phải của một mock trung gian.
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

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/** Header gửi đi, đọc qua `Headers` để không phụ thuộc kiểu init.headers. */
function sentHeader(call: FetchCall, name: string): string | null {
  return new Headers(call.init?.headers ?? {}).get(name)
}

/** FX-CACHE của §4.4. */
const FX_CACHE = { en: { etag: '"abc"', messages: { common: { ok: 'OK' } } } }

function seedCache(value: unknown = FX_CACHE) {
  localStorage.setItem(I18N_CACHE_KEY, typeof value === 'string' ? value : JSON.stringify(value))
}

function readCache(): Record<string, { etag: string; messages: Record<string, unknown> }> {
  return JSON.parse(localStorage.getItem(I18N_CACHE_KEY) ?? '{}')
}

function reset() {
  calls = []
  localStorage.clear()
  useAppSettings().load()
  setI18nLocale('vi')
  const store = useLocaleMessages()
  store.loadedLocales.value = []
  store.lastError.value = null
  store.manifestError.value = null
  store.pending.value = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
}

beforeEach(reset)
afterEach(reset)

describe('primeFromCache — bơm ĐỒNG BỘ, gọi được trước mount', () => {
  it('TC-G01: có cache ⇒ true và messages vào vue-i18n ngay trong lượt đồng bộ', () => {
    seedCache()
    // 🚫 Không await: đây chính là tính chất ca này chốt.
    expect(primeFromCache('en')).toBe(true)
    setI18nLocale('en')
    expect(t('common.ok')).toBe('OK')
    expect(useLocaleMessages().loadedLocales.value).toContain('en')
  })

  it('TC-G02: không có cache ⇒ false, 🚫 không ném', () => {
    expect(primeFromCache('en')).toBe(false)
    expect(useLocaleMessages().loadedLocales.value).not.toContain('en')
  })

  it('TC-G03: cache hỏng (không parse được) ⇒ false, và `ensureLocale` sau vẫn chạy', async () => {
    seedCache('{khong-phai-json')
    expect(primeFromCache('en')).toBe(false)

    stubFetch(() => jsonResponse({ locale: 'en', messages: { common: { ok: 'OK' } } }))
    expect(await ensureLocale('en')).toBe(true)
    expect(calls.map((c) => c.url)).toEqual(['/api/i18n/en'])
  })

  it('TC-G03b: cache shape sai (thiếu `messages`) ⇒ false', () => {
    seedCache({ en: { etag: '"abc"' } })
    expect(primeFromCache('en')).toBe(false)
    seedCache({ en: { etag: '"abc"', messages: ['khong-phai-object'] } })
    expect(primeFromCache('en')).toBe(false)
    seedCache(['mang-o-cap-cao-nhat'])
    expect(primeFromCache('en')).toBe(false)
  })

  it('TC-G13: `localStorage.getItem` ném ⇒ false, `ensureLocale` vẫn chạy được (G-C10)', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('private mode')
    })
    expect(primeFromCache('en')).toBe(false)

    vi.restoreAllMocks()
    stubFetch(() => jsonResponse({ locale: 'en', messages: { common: { ok: 'OK' } } }))
    expect(await ensureLocale('en')).toBe(true)
  })
})

describe('ensureLocale — nạp qua mạng', () => {
  it('TC-G04: cache rỗng, API 200 ⇒ messages vào vue-i18n và vào cache', async () => {
    stubFetch(() =>
      jsonResponse({ locale: 'en', messages: { common: { ok: 'OK' } } }, { ETag: '"e1"' }),
    )

    expect(await ensureLocale('en')).toBe(true)
    setI18nLocale('en')
    expect(t('common.ok')).toBe('OK')
    expect(readCache().en.etag).toBe('"e1"')
    expect(readCache().en.messages).toEqual({ common: { ok: 'OK' } })
  })

  it('TC-G05: đã có cache ⇒ gửi `If-None-Match` bằng ĐÚNG etag đã lưu', async () => {
    seedCache()
    stubFetch(() => new Response(null, { status: 304 }))

    await ensureLocale('en')
    expect(calls).toHaveLength(1)
    expect(sentHeader(calls[0], 'If-None-Match')).toBe('"abc"')
  })

  it('TC-G06: 304 ⇒ true, 🚫 không đọc body, cache và messages KHÔNG đổi', async () => {
    seedCache()
    const before = localStorage.getItem(I18N_CACHE_KEY)
    const res = new Response(null, { status: 304 })
    const json = vi.spyOn(res, 'json')
    stubFetch(() => res)

    expect(await ensureLocale('en')).toBe(true)
    expect(json).not.toHaveBeenCalled()
    expect(localStorage.getItem(I18N_CACHE_KEY)).toBe(before)
    setI18nLocale('en')
    expect(t('common.ok')).toBe('OK')
  })

  it('TC-G07: 200 với ETag mới ⇒ cache đổi etag, khoá cũ còn, khoá mới có (G-C16)', async () => {
    seedCache()
    primeFromCache('en')
    stubFetch(() =>
      jsonResponse({ locale: 'en', messages: { common: { them: 'NEW' } } }, { ETag: '"e2"' }),
    )

    expect(await ensureLocale('en')).toBe(true)
    expect(readCache().en.etag).toBe('"e2"')

    setI18nLocale('en')
    // Deep-merge ở tầng vue-i18n: khoá cũ `ok` vẫn còn, khoá mới `them` có.
    expect(t('common.ok')).toBe('OK')
    expect(t('common.them')).toBe('NEW')
  })

  it('TC-G18: `force: true` ⇒ 🚫 không gửi `If-None-Match`', async () => {
    seedCache()
    stubFetch(() => jsonResponse({ locale: 'en', messages: { common: { ok: 'OK' } } }))

    await ensureLocale('en', { force: true })
    expect(calls).toHaveLength(1)
    expect(sentHeader(calls[0], 'If-None-Match')).toBeNull()
  })
})

describe('ensureLocale — đường hỏng 🚫 không ném', () => {
  it('TC-G08: API 500 ⇒ không ném; true khi đã có bản build-time, false khi chưa', async () => {
    stubFetch(() => new Response('boom', { status: 500 }))

    // `en` có messages build-time → vẫn dùng được, chỉ là chữ cũ, không báo lỗi.
    expect(await ensureLocale('en')).toBe(true)
    expect(useLocaleMessages().lastError.value).toBeNull()

    // `de` chưa có gì ở vue-i18n → báo đúng là không nạp được.
    expect(await ensureLocale('de')).toBe(false)
    expect(useLocaleMessages().lastError.value).toContain('500')
  })

  it('TC-G09: mạng chết (fetch reject) ⇒ như TC-G08, 🚫 không ném ra ngoài', async () => {
    stubFetch(() => Promise.reject(new Error('network')))

    expect(await ensureLocale('en')).toBe(true)
    expect(useLocaleMessages().lastError.value).toBeNull()
    expect(await ensureLocale('de')).toBe(false)
    expect(useLocaleMessages().lastError.value).toContain('network')
  })

  it('TC-G09b: lỗi của lượt trước bị xoá khi lượt sau thành công (200 và 304)', async () => {
    const store = useLocaleMessages()

    store.lastError.value = 'i18n 500'
    stubFetch(() => jsonResponse({ locale: 'en', messages: { common: { ok: 'OK' } } }, { ETag: '"e1"' }))
    expect(await ensureLocale('en')).toBe(true)
    expect(store.lastError.value).toBeNull()

    store.lastError.value = 'i18n 500'
    vi.unstubAllGlobals()
    stubFetch(() => new Response(null, { status: 304 }))
    expect(await ensureLocale('en')).toBe(true)
    expect(store.lastError.value).toBeNull()
  })

  it('TC-G12: `localStorage.setItem` ném (quota/private) ⇒ vẫn true, messages vẫn vào (G-C10)', async () => {
    stubFetch(() =>
      jsonResponse({ locale: 'en', messages: { common: { ok: 'QUOTA' } } }, { ETag: '"e1"' }),
    )
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(await ensureLocale('en')).toBe(true)
    setI18nLocale('en')
    expect(t('common.ok')).toBe('QUOTA')
  })

  it('TC-G14: cờ `pending` lên khi đang bay, về null ở CẢ nhánh thành công và nhánh lỗi', async () => {
    const store = useLocaleMessages()

    let seenDuringSuccess: string | null = null
    stubFetch(async () => {
      seenDuringSuccess = store.pending.value
      return jsonResponse({ locale: 'en', messages: {} })
    })
    await ensureLocale('en')
    expect(seenDuringSuccess).toBe('en')
    expect(store.pending.value).toBeNull()

    let seenDuringFailure: string | null = null
    stubFetch(async () => {
      seenDuringFailure = store.pending.value
      throw new Error('network')
    })
    await ensureLocale('de')
    expect(seenDuringFailure).toBe('de')
    expect(store.pending.value).toBeNull()
  })
})

describe('ensureLocale — dedupe và tách biệt', () => {
  it('TC-G10: 3 lượt gọi đồng thời ⇒ ĐÚNG 1 request, cả 3 resolve cùng giá trị (G-C11)', async () => {
    stubFetch(
      () =>
        new Promise<Response>((resolve) =>
          setTimeout(() => resolve(jsonResponse({ locale: 'en', messages: {} })), 10),
        ),
    )

    const results = await Promise.all([
      ensureLocale('en'),
      ensureLocale('en'),
      ensureLocale('en'),
    ])

    expect(calls).toHaveLength(1)
    expect(results).toEqual([true, true, true])
  })

  it('TC-G11: xong rồi gọi lại với `force: true` ⇒ request thứ 2 bay ra (map inflight đã dọn)', async () => {
    stubFetch(() => jsonResponse({ locale: 'en', messages: {} }))

    await ensureLocale('en')
    await ensureLocale('en', { force: true })
    expect(calls.map((c) => c.url)).toEqual(['/api/i18n/en', '/api/i18n/en'])
  })

  it('TC-G15: cache i18n tách khỏi settings — `dev-dashboard-app-settings` KHÔNG đổi', async () => {
    useAppSettings().update({ theme: 'dark' })
    const settingsBefore = localStorage.getItem(STORAGE_KEY)

    stubFetch(() =>
      jsonResponse({ locale: 'en', messages: { common: { ok: 'OK' } } }, { ETag: '"e1"' }),
    )
    await ensureLocale('en')

    expect(localStorage.getItem(STORAGE_KEY)).toBe(settingsBefore)
    expect(localStorage.getItem(I18N_CACHE_KEY)).not.toBeNull()
  })
})

/** Response điều khiển tay: request treo tới khi test gọi `resolve`. */
function deferredFetch() {
  const waiters: Array<(res: Response) => void> = []
  stubFetch(() => new Promise<Response>((resolve) => waiters.push(resolve)))
  return waiters
}

/** Chờ các microtask đang xếp hàng chạy xong. */
async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('ensureLocale — inflight, force, pending nhiều locale', () => {
  it('lượt gọi lồng từ trong lúc gửi request ⇒ dùng chung lượt đang bay, ĐÚNG 1 request', async () => {
    let nested: Promise<boolean> | null = null
    stubFetch(() => {
      nested ??= ensureLocale('en')
      return jsonResponse({ locale: 'en', messages: {} })
    })

    expect(await ensureLocale('en')).toBe(true)
    expect(await nested).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('`force` khi lượt thường đang bay ⇒ request thứ 2 bay ra, không gửi `If-None-Match`', async () => {
    seedCache()
    const waiters = deferredFetch()

    const normal = ensureLocale('en')
    await flush()
    const forced = ensureLocale('en', { force: true })
    await flush()

    expect(calls).toHaveLength(2)
    expect(sentHeader(calls[0], 'If-None-Match')).toBe('"abc"')
    expect(sentHeader(calls[1], 'If-None-Match')).toBeNull()

    waiters[0](new Response(null, { status: 304 }))
    waiters[1](jsonResponse({ locale: 'en', messages: { common: { ok: 'MOI' } } }, { ETag: '"e2"' }))
    expect(await Promise.all([normal, forced])).toEqual([true, true])
    expect(readCache().en.etag).toBe('"e2"')
  })

  it('lượt `force` đang bay ⇒ lượt force và lượt thường sau đó dùng chung, không thêm request', async () => {
    const waiters = deferredFetch()

    const first = ensureLocale('en', { force: true })
    await flush()
    const again = ensureLocale('en', { force: true })
    const normal = ensureLocale('en')
    await flush()
    expect(calls).toHaveLength(1)

    waiters[0](jsonResponse({ locale: 'en', messages: {} }))
    expect(await Promise.all([first, again, normal])).toEqual([true, true, true])
  })

  it('hai locale nạp song song ⇒ `pending` giữ locale còn đang bay, chỉ về null khi cả hai xong', async () => {
    const store = useLocaleMessages()
    const waiters = deferredFetch()

    const en = ensureLocale('en')
    const fr = ensureLocale('fr')
    await flush()
    expect(store.pending.value).toBe('fr')

    waiters[1](jsonResponse({ locale: 'fr', messages: { common: { ok: 'FR' } } }))
    await fr
    expect(store.pending.value).toBe('en')

    waiters[0](jsonResponse({ locale: 'en', messages: {} }))
    await en
    expect(store.pending.value).toBeNull()
  })
})

describe('ensureLocale — timeout', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('request quá hạn ⇒ abort signal, rơi về bản build-time, `inflight` được dọn', async () => {
    let signal: AbortSignal | undefined
    stubFetch(
      (_url, init) =>
        new Promise<Response>((_, reject) => {
          signal = init?.signal ?? undefined
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )

    const p = ensureLocale('en')
    await vi.advanceTimersByTimeAsync(LOCALE_FETCH_TIMEOUT_MS)

    expect(await p).toBe(true)
    expect(signal?.aborted).toBe(true)
    expect(useLocaleMessages().lastError.value).toBeNull()
    expect(useLocaleMessages().pending.value).toBeNull()

    stubFetch(() => jsonResponse({ locale: 'en', messages: {} }))
    expect(await ensureLocale('en')).toBe(true)
    expect(calls).toHaveLength(2)
  })

  it('fetch bỏ qua signal và treo mãi ⇒ vẫn trả sau timeout; locale chưa có gì ⇒ false + lỗi timeout', async () => {
    stubFetch(() => new Promise<Response>(() => {}))

    const p = ensureLocale('it')
    await vi.advanceTimersByTimeAsync(LOCALE_FETCH_TIMEOUT_MS - 1)
    expect(useLocaleMessages().pending.value).toBe('it')
    await vi.advanceTimersByTimeAsync(1)

    expect(await p).toBe(false)
    expect(useLocaleMessages().lastError.value).toContain('timeout')
    expect(useLocaleMessages().pending.value).toBeNull()

    stubFetch(() => new Response('boom', { status: 500 }))
    expect(await ensureLocale('it')).toBe(false)
    expect(calls).toHaveLength(2)
  })
})

describe('ensureManifest — đồng bộ danh sách locale', () => {
  it('TC-G16: manifest trả locale mới ⇒ registry có locale đó sau khi await', async () => {
    stubFetch(() => jsonResponse({ locales: ['vi', 'en', 'ja'], defaultLocale: 'vi' }))

    expect(supportedLocales()).not.toContain('ja')
    await ensureManifest()
    expect(supportedLocales()).toContain('ja')
  })

  it('TC-G17: manifest lỗi ⇒ 🚫 không ném, registry GIỮ NGUYÊN', async () => {
    const before = [...supportedLocales()]
    stubFetch(() => new Response('boom', { status: 500 }))

    await ensureManifest()

    expect([...supportedLocales()]).toEqual(before)
    // Lỗi manifest tách riêng, 🚫 không thành "không tải được bản dịch" ở Settings.
    expect(useLocaleMessages().manifestError.value).not.toBeNull()
    expect(useLocaleMessages().lastError.value).toBeNull()
  })

  it('TC-G17b: manifest trả body rác ⇒ 🚫 không ném, registry giữ nguyên', async () => {
    const before = [...supportedLocales()]
    stubFetch(() => jsonResponse({ khong: 'co locales' }))

    await ensureManifest()
    expect([...supportedLocales()]).toEqual(before)
  })
})

describe('bề mặt store', () => {
  it('`useLocaleMessages()` là singleton xuyên caller', () => {
    expect(useLocaleMessages().loadedLocales).toBe(useLocaleMessages().loadedLocales)
    expect(useLocaleMessages().registry).toBe(useLocaleMessages().registry)
  })

  it('messages build-time có mặt trong vue-i18n trước mọi lượt nạp (đường fallback)', () => {
    expect(Object.keys(i18n.global.getLocaleMessage('vi') as object).length).toBeGreaterThan(0)
    expect(Object.keys(i18n.global.getLocaleMessage('en') as object).length).toBeGreaterThan(0)
  })
})
