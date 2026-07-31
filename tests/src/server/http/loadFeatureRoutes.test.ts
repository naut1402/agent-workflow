import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { registerFeatureRoutes } from '../../../../src/core/http/loadFeatureRoutes.js'
import type { HonoEnv } from '../../../../src/core/http/types.js'

describe('registerFeatureRoutes', () => {
  test('loads feature api modules and registers known routes', async () => {
    const app = new Hono<HonoEnv>()
    await registerFeatureRoutes(app)

    // Smoke: routes from settings + runner + logs coexist after ordered load.
    const paths = app.routes.map((r) => `${r.method} ${r.path}`)
    expect(paths).toContain('GET /api/projects')
    expect(paths).toContain('GET /api/runners')
    expect(paths).toContain('GET /api/jobs/:id/log')
    expect(paths).toContain('GET /api/tasks')
  })
})
