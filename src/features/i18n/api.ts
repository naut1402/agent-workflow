import type { Hono } from 'hono'
import type { HonoEnv } from '../../backend/http/types.js'
import { bind } from '../../backend/http/AbstractController.js'
import { I18nController } from './controller.js'

export function registerRoutes(app: Hono<HonoEnv>): void {
  // Hono match theo thứ tự đăng ký → `manifest` phải đứng TRƯỚC `:locale`,
  // nếu không nó bị nuốt thành một giá trị `:locale` (tiền lệ `knowledge/api.ts`).
  app.get('/api/i18n/manifest', bind(I18nController, 'getManifest'))
  app.get('/api/i18n/:locale', bind(I18nController, 'getLocale'))
}
