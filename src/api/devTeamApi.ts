import fsSync from 'node:fs'
import { createRegistryContext } from '../core/registry.js'
import { createApiHandler } from './apiServer.js'

// API setup entrypoints:
//
//   createApiHandler(ctx) → async (req,res)=>boolean   (shared by both transports)
//   devTeamApi({ root })  → Vite middleware plugin      (dev mode)
//
// The standalone entry (src/standalone.ts) mounts createApiHandler too.

export { createApiHandler }

// Vite plugin wrapper around the shared core handler. Builds a ctx whose
// default project root is the legacy `root` (cwd/.. or DEV_TEAM_ROOT), then
// serves /api/* through createApiHandler — dev mode behaves exactly as before
// while gaining multi-project support via `?project=`.
export function devTeamApi({ root }: { root: string }) {
  const ctx = createRegistryContext({ defaultRoot: root })
  const apiHandler = createApiHandler(ctx)

  return {
    name: 'dev-team-api',
    configureServer(server: any) {
      const exists = fsSync.existsSync(root)
      server.config.logger.info(
        `\n  dev-team-dashboard → default root: ${root}${exists ? '' : '  (does not exist yet)'}\n`,
      )
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const handled = await apiHandler(req, res)
        if (!handled) return next()
      })
    },
  }
}
