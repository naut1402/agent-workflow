import type { Hono } from 'hono'
import type { HonoEnv } from '../../backend/http/types.js'
import { bind } from '../../backend/http/AbstractController.js'
import { McpController } from './controller.js'

export function registerRoutes(app: Hono<HonoEnv>): void {
  app.post('/api/mcp-servers/test', bind(McpController, 'testServer'))
  app.get('/api/mcp-servers', bind(McpController, 'listServers'))
  app.post('/api/mcp-servers', bind(McpController, 'upsertServer'))
  app.delete('/api/mcp-servers', bind(McpController, 'deleteServer'))
  app.all('/api/mcp-servers', bind(McpController, 'methodNotAllowedHere'))
}
