import type { Hono } from 'hono'
import type { HonoEnv } from '../../core/http/types.js'
import { bind } from '../../core/http/AbstractController.js'
import { WebhookController } from './controller.js'

export const routeOrder = 45

export function registerRoutes(app: Hono<HonoEnv>): void {
  app.get('/api/webhooks', bind(WebhookController, 'listConfigs'))
  app.get('/api/webhooks/config', bind(WebhookController, 'getConfig'))
  app.put('/api/webhooks/config', bind(WebhookController, 'upsertConfig'))
  app.post('/api/webhooks/github', bind(WebhookController, 'receiveGithub'))
}
