import { Hono } from 'hono'
import type { RegistryContext } from '../registry.js'
import type { HonoEnv } from './types.js'
import { j } from './respond.js'
import { registerRegistryRoutes } from './routes/registry.js'
import { registerRunnerRoutes } from './routes/runners.js'
import { registerTaskRoutes } from './routes/tasks.js'
import { registerConfigRoutes } from './routes/config.js'
import { registerCatalogRoutes } from './routes/catalog.js'
import { registerAgentRoutes } from './routes/agents.js'
import { registerLogRoutes } from '../../features/logs/server/routes.js'
import { registerFsRoutes } from './routes/fs.js'
import { registerAutoscanRoutes } from './routes/autoscan.js'
import { registerGithubTokensRoutes } from './routes/githubTokens.js'
import { registerNlChatRoutes } from './routes/nlChat.js'

// Build the Hono app for all /api/* routes except /api/knowledge (which stays
// node-res based and is intercepted by the node adapter before Hono).
//
// A single middleware resolves the per-request `.dev-team-agent/` root from
// `?project=<id>` via ctx.resolveProjectRoot (replacing the old per-dispatch
// resolution), then each route reads c.get('root') and 404s when null.
export function createApp(ctx: RegistryContext): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>()

  app.use('/api/*', async (c, next) => {
    const projectId = c.req.query('project') || null
    c.set('ctx', ctx)
    c.set('projectId', projectId)
    c.set('root', ctx.resolveProjectRoot(projectId))
    await next()
  })

  registerRegistryRoutes(app)
  registerFsRoutes(app)
  registerAutoscanRoutes(app)
  registerGithubTokensRoutes(app)
  registerRunnerRoutes(app)
  // After runners: /api/jobs/:id/log must coexist with /api/jobs/:id (Hono picks
  // the more specific route).
  registerLogRoutes(app)
  registerTaskRoutes(app)
  registerConfigRoutes(app)
  registerCatalogRoutes(app)
  registerAgentRoutes(app)
  registerNlChatRoutes(app)

  app.notFound((c) => j(c, 404, { error: 'unknown endpoint' }))
  app.onError((err, c) => j(c, 500, { error: String((err as any)?.message ?? err) }))

  return app
}
