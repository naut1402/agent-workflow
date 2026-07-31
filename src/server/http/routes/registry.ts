import type { Hono } from 'hono'
import type { HonoEnv } from '../types.js'
import { j } from '../respond.js'
import { emitAudit } from '../../../features/logs/server/store.js'

// Project registry CRUD — no per-project root needed.
export function registerRegistryRoutes(app: Hono<HonoEnv>): void {
  app.get('/api/projects', (c) => {
    const { registry } = c.get('ctx')
    const id = c.req.query('id')
    if (id) {
      const project = registry.get(id)
      if (!project) return j(c, 404, { error: 'unknown project', id })
      return j(c, 200, { project })
    }
    return j(c, 200, registry.list())
  })

  app.post('/api/projects', async (c) => {
    const { registry } = c.get('ctx')
    let parsed: any
    try {
      parsed = JSON.parse((await c.req.text()) || '{}')
    } catch {
      return j(c, 400, { error: 'invalid JSON' })
    }
    const result = registry.add({ path: parsed.path, name: parsed.name })
    if ('error' in result) return j(c, result.status || 400, { error: result.error })
    emitAudit({ op: 'create', entity: 'project', identifier: result.project?.id ?? null, projectId: result.project?.id ?? null })
    return j(c, 201, { project: result.project })
  })

  app.delete('/api/projects', (c) => {
    const { registry } = c.get('ctx')
    const id = c.req.query('id') || ''
    const result = registry.remove(id)
    if ('error' in result) return j(c, result.status || 400, { error: result.error })
    emitAudit({ op: 'delete', entity: 'project', identifier: id, projectId: id })
    return j(c, 200, { removed: true })
  })

  app.all('/api/projects', (c) => j(c, 405, { error: 'method not allowed' }))
}
