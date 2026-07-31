import type { Hono } from 'hono'
import type { HonoEnv } from '../types.js'
import { j, parseBody } from '../respond.js'
import { loadGithubTokensConfig, saveGithubTokensConfig } from '../../autoscan/config.js'
import { parseGithubTokensConfig } from '../../../core/contracts/schemas/githubTokens.js'
import { emitAudit } from '../../logging/store.js'

/** CRUD for per-repo GitHub PATs used when fetching private issues. */
export function registerGithubTokensRoutes(app: Hono<HonoEnv>): void {
  app.get('/api/github/tokens', (c) => {
    return j(c, 200, { config: loadGithubTokensConfig() })
  })

  app.put('/api/github/tokens', async (c) => {
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON' })
    const next = parseGithubTokensConfig(b.value)
    const saved = saveGithubTokensConfig(next)
    emitAudit({ op: 'update', entity: 'github-tokens', identifier: 'config', projectId: null })
    return j(c, 200, { config: saved })
  })
}
