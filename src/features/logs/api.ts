import type { Hono } from 'hono'
import type { HonoEnv } from '../../core/http/types.js'
import { bind } from '../../core/http/AbstractController.js'
import { LogsController } from './controller.js'

/** Sau runners để `/api/jobs/:id/log` không bị `:id` nuốt. */
export const routeOrder = 60

export function registerRoutes(app: Hono<HonoEnv>): void {
  app.get('/api/logs', bind(LogsController, 'listLogs'))
  app.get('/api/jobs/:id/log', bind(LogsController, 'getJobLog'))
  app.get('/api/tasks/:taskId/job-log', bind(LogsController, 'getTaskJobLog'))
}
