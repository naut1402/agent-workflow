import type { Hono } from 'hono'
import type { HonoEnv } from '../types.js'
import { j, parseBody } from '../respond.js'
import { loadAutoscanConfig, saveAutoscanConfig, runAutoscan } from '../../autoscan/index.js'
import { parseAutoscanConfig } from '../../../core/contracts/schemas/autoscan.js'
import { emitAudit } from '../../../features/logs/server/store.js'

/** Autoscan config + on-demand scan against the project registry. */
export function registerAutoscanRoutes(app: Hono<HonoEnv>): void {
  app.get('/api/autoscan', (c) => {
    return j(c, 200, { config: loadAutoscanConfig() })
  })

  app.put('/api/autoscan', async (c) => {
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON' })
    const next = parseAutoscanConfig({
      ...loadAutoscanConfig(),
      ...b.value,
    })
    const saved = saveAutoscanConfig(next)
    emitAudit({ op: 'update', entity: 'autoscan', identifier: 'config', projectId: null })
    return j(c, 200, { config: saved })
  })

  app.post('/api/autoscan/run', async (c) => {
    const config = loadAutoscanConfig()
    // Optional body may override whitelist for a one-shot run (settings "scan now"
    // with unsaved edits); otherwise use persisted whitelist.
    const b = await parseBody(c)
    let whitelist = config.whitelist
    if (b.ok && Array.isArray(b.value?.whitelist)) {
      whitelist = b.value.whitelist.map((p: unknown) => String(p)).filter(Boolean)
    }
    if (!whitelist.length) {
      return j(c, 200, {
        report: {
          scanned: 0,
          added: [],
          existing: [],
          skipped: [],
          errors: [],
          hits: [],
        },
      })
    }
    const report = await runAutoscan(whitelist)
    emitAudit({
      op: 'create',
      entity: 'autoscan',
      identifier: 'run',
      projectId: null,
      detail: { added: report.added.length, existing: report.existing.length },
    })
    return j(c, 200, { report })
  })
}
