import type { Hono } from 'hono'
import type { HonoEnv } from '../../backend/http/types.js'
import { bind } from '../../backend/http/AbstractController.js'
import { I18nController } from './controller.js'

export function registerRoutes(app: Hono<HonoEnv>): void {
  // `manifest` đăng ký trước `:locale`.
  app.get('/api/i18n/manifest', bind(I18nController, 'getManifest'))
  app.get('/api/i18n/:locale', bind(I18nController, 'getLocale'))
}
