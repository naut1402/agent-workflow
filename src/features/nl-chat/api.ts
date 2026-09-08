import type { Hono } from 'hono'
import type { HonoEnv } from '../../core/http/types.js'
import { bind } from '../../core/http/AbstractController.js'
import { NlChatController } from './controller.js'

export const routeOrder = 100

export function registerRoutes(app: Hono<HonoEnv>): void {
  app.post('/api/nl-chat/sessions', bind(NlChatController, 'createSession'))
  app.post('/api/nl-chat/sessions/:id/messages', bind(NlChatController, 'postMessage'))
  app.get('/api/nl-chat/sessions/:id', bind(NlChatController, 'getSession'))
  app.post('/api/nl-chat/sessions/:id/cancel', bind(NlChatController, 'cancelSession'))
  app.post('/api/nl-chat/attachments', bind(NlChatController, 'uploadAttachments'))
}
