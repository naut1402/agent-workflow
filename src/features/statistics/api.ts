import type { Hono } from 'hono'
import type { HonoEnv } from '../../core/http/types.js'
import { bind } from '../../core/http/AbstractController.js'
import { StatisticsController } from './controller.js'

/** Sau logs (60) — không có route `:param` tranh chấp, giữ thứ tự ổn định. */
export const routeOrder = 65

export function registerRoutes(app: Hono<HonoEnv>): void {
  app.get('/api/statistics/usage', bind(StatisticsController, 'usageStats'))
}
