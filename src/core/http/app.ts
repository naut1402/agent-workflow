import { Hono } from 'hono'
import type { HonoEnv, RegistryContext } from './types.js'
import { j } from './respond.js'
import { registerFeatureRoutes } from './loadFeatureRoutes.js'

// Build the Hono app for all /api/* routes except /api/knowledge (which stays
// node-res based and is intercepted by the node adapter before Hono).
//
// Feature APIs: `api.ts` map route → bind(Controller, method); logic ở controller.ts.
// Đăng ký static trong loadFeatureRoutes.ts (+ routeOrder).
//
// A single middleware resolves the per-request `.dev-team-agent/` root from
// `?project=<id>` via ctx.resolveProjectRoot, then each route reads c.get('root').
export async function createApp(ctx: RegistryContext): Promise<Hono<HonoEnv>> {
  const app = new Hono<HonoEnv>()

  app.use('/api/*', async (c, next) => {
    const projectId = c.req.query('project') || null
    c.set('ctx', ctx)
    c.set('projectId', projectId)
    c.set('root', ctx.resolveProjectRoot(projectId))
    await next()
  })

  await registerFeatureRoutes(app)

  app.notFound((c) => j(c, 404, { error: 'unknown endpoint' }))
  app.onError((err, c) => j(c, 500, { error: String((err as any)?.message ?? err) }))

  return app
}
