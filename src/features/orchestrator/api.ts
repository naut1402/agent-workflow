import type { Hono } from 'hono'
import type { HonoEnv } from '../../backend/http/types.js'
import { bind } from '../../backend/http/AbstractController.js'
import { OrchestratorController } from './controller.js'
// xem docs/architecture/code/orchestrator.md §11
import './business/index.js'

export function registerRoutes(app: Hono<HonoEnv>): void {
  app.get('/api/orchestrator/status', bind(OrchestratorController, 'getStatus'))
  app.get('/api/orchestrator/output', bind(OrchestratorController, 'getOutput'))
  app.post('/api/orchestrator/decide', bind(OrchestratorController, 'postDecide'))
}
