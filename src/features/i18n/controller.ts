import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { AbstractController } from '../../backend/http/AbstractController.js'
import { DEFAULT_LOCALE, listLocales, localeEtag, readLocaleBundle } from './business/index.js'
import { LocaleParam } from './schemas/i18n.js'

/**
 * Chuỗi dịch cho client. Read-only và **global**: cố tình bỏ qua `?project=`
 * (`projectId` / `root`) và đọc `ctx.defaultRoot` — đổi project không được đổi
 * ngôn ngữ, và project lạ không được thành 404 (G-C3).
 */
export class I18nController extends AbstractController {
  /** `GET /api/i18n/manifest` — danh sách locale phục vụ được. */
  async getManifest(): Promise<Response> {
    const locales = await listLocales(this.ctx.defaultRoot)
    return this.cacheable(200, { locales, defaultLocale: DEFAULT_LOCALE })
  }

  /** `GET /api/i18n/:locale` — bundle đã merge overlay, hoặc 304 khi ETag còn khớp. */
  async getLocale(): Promise<Response> {
    const parsed = LocaleParam.safeParse(this.c.req.param('locale'))
    if (!parsed.success) return this.badRequest('invalid locale code')

    const bundle = await readLocaleBundle(parsed.data, this.ctx.defaultRoot)
    if (!bundle) return this.notFound('unknown locale', { locale: parsed.data })

    const etag = localeEtag(bundle)
    if (matchesIfNoneMatch(this.c.req.header('If-None-Match'), etag)) {
      // 304 KHÔNG có body; vẫn phải trả lại ETag để client giữ nguyên cache.
      this.c.header('ETag', etag)
      this.c.header('Cache-Control', 'no-cache')
      return this.c.body(null, 304)
    }
    return this.cacheable(200, { locale: parsed.data, messages: bundle }, etag)
  }

  /**
   * Helper riêng của feature này — KHÔNG thêm vào `AbstractController`.
   * `AbstractController.json()` ép `Cache-Control: no-store` cho mọi response, và
   * `no-store` ở đây là mất sạch lợi ích ETag (mỗi lần boot tải lại ~1.4k khoá).
   * Lỗi vẫn đi qua method base — `no-store` cho lỗi là đúng (G-C1).
   */
  private cacheable(status: number, body: unknown, etag?: string): Response {
    if (etag) this.c.header('ETag', etag)
    // `no-cache` = được cache nhưng BẮT BUỘC revalidate. Không phải `no-store`.
    this.c.header('Cache-Control', 'no-cache')
    return this.c.json(body as never, status as ContentfulStatusCode)
  }
}

/**
 * So khớp `If-None-Match` theo RFC 9110 §13.1.2: **weak comparison**, và `*` khớp
 * mọi resource đang tồn tại. `W/"x"` và `"x"` là cùng một validator ở đây.
 */
function matchesIfNoneMatch(header: string | undefined, etag: string): boolean {
  if (!header) return false
  const strip = (v: string) => v.trim().replace(/^W\//, '')
  const target = strip(etag)
  return header
    .split(',')
    .some((candidate) => candidate.trim() === '*' || strip(candidate) === target)
}
