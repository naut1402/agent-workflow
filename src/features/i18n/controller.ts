import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { AbstractController } from '../../backend/http/AbstractController.js'
import { DEFAULT_LOCALE, listLocales, readLocaleBundleCached } from './business/index.js'
import { LocaleParam } from './schemas/i18n.js'

/** Chuỗi dịch dùng chung mọi project: đọc `ctx.defaultRoot`, bỏ qua `?project=`. */
export class I18nController extends AbstractController {
  /** `GET /api/i18n/manifest` */
  async getManifest(): Promise<Response> {
    const locales = await listLocales(this.ctx.defaultRoot)
    return this.cacheable(200, { locales, defaultLocale: DEFAULT_LOCALE })
  }

  /** `GET /api/i18n/:locale` — 304 khi `If-None-Match` khớp ETag. */
  async getLocale(): Promise<Response> {
    const parsed = LocaleParam.safeParse(this.c.req.param('locale'))
    if (!parsed.success) return this.badRequest('invalid locale code')

    const entry = await readLocaleBundleCached(parsed.data, this.ctx.defaultRoot)
    if (!entry) return this.notFound('unknown locale', { locale: parsed.data })

    const { bundle, etag } = entry
    if (matchesIfNoneMatch(this.c.req.header('If-None-Match'), etag)) {
      this.c.header('ETag', etag)
      this.c.header('Cache-Control', 'no-cache')
      return this.c.body(null, 304)
    }
    return this.cacheable(200, { locale: parsed.data, messages: bundle }, etag)
  }

  private cacheable(status: number, body: unknown, etag?: string): Response {
    if (etag) this.c.header('ETag', etag)
    this.c.header('Cache-Control', 'no-cache')
    return this.c.json(body as never, status as ContentfulStatusCode)
  }
}

function matchesIfNoneMatch(header: string | undefined, etag: string): boolean {
  if (!header) return false
  const strip = (v: string) => v.trim().replace(/^W\//, '')
  const target = strip(etag)
  return header
    .split(',')
    .some((candidate) => candidate.trim() === '*' || strip(candidate) === target)
}
