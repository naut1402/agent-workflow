import type { Hono } from 'hono'
import type { HonoEnv } from '../types.js'
import { j } from '../respond.js'
import { browseDirectory } from '../../fsBrowse.js'

/** Local filesystem directory browser (folder picker). */
export function registerFsRoutes(app: Hono<HonoEnv>): void {
  app.get('/api/fs/browse', async (c) => {
    // Missing query → default home; explicit empty / __roots__ handled in browseDirectory.
    const pathParam = c.req.query('path')
    const outcome = await browseDirectory(pathParam === undefined ? undefined : pathParam)
    if ('error' in outcome) return j(c, outcome.status || 400, { error: outcome.error })
    return j(c, 200, outcome.result)
  })
}
