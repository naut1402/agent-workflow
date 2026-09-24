import fsSync from 'node:fs'
import { createRegistryContext } from './registry.js'
import { createApiHandler } from './apiServer.js'

// Shim: re-exports createApiHandler + the Vite dev-mode plugin devTeamApi().

export { createApiHandler }

// Default root is the legacy `root` (cwd/.. or DEV_TEAM_ROOT) so existing
// single-project use still works, while `?project=` opts into multi-project.
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
      // Tương đương standalone.ts cho transport Vite dev — cho claude-code-cli.ts biết base URL gọi ngược route MCP orchestrator.
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
