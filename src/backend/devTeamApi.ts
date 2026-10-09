import fsSync from 'node:fs'
import { createRegistryContext } from './registry.js'
import { createApiHandler } from './apiServer.js'

export { createApiHandler }

/** Vite dev plugin mounting the API; `root` is the project served when no `?project=` is given. */
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
      // xem docs/architecture/code/backend.md §6
      server.httpServer?.once('listening', () => {
        const addr = server.httpServer.address()
        if (addr && typeof addr === 'object') {
          process.env.DEV_TEAM_SELF_BASE_URL = `http://127.0.0.1:${addr.port}`
        }
      })
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const handled = await apiHandler(req, res)
        if (!handled) return next()
      })
    },
  }
}
