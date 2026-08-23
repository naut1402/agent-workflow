import type { Hono } from 'hono'
import type { HonoEnv } from '../../core/http/types.js'
import { bind } from '../../core/http/AbstractController.js'
import { AutomationsController } from './controller.js'

export const routeOrder = 65

export function registerRoutes(app: Hono<HonoEnv>): void {
  app.get('/api/automations', bind(AutomationsController, 'listAutomations'))
  app.get('/api/automations/event-types', bind(AutomationsController, 'listEventTypes'))
  app.get('/api/automations/form-options', bind(AutomationsController, 'formOptions'))
  app.get('/api/automations/runs', bind(AutomationsController, 'listAllRuns'))
  app.post('/api/automations', bind(AutomationsController, 'createAutomation'))
  app.put('/api/automations/:id', bind(AutomationsController, 'updateAutomation'))
  app.post('/api/automations/:id/toggle', bind(AutomationsController, 'toggleAutomation'))
  app.post('/api/automations/:id/run', bind(AutomationsController, 'runNow'))
  app.get('/api/automations/:id/runs', bind(AutomationsController, 'listRuleRuns'))
  app.delete('/api/automations/:id', bind(AutomationsController, 'deleteAutomation'))
}
