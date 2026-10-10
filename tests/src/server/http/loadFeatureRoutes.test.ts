import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { registerFeatureRoutes } from '../../../../src/backend/apiServer.js'
import type { HonoEnv } from '../../../../src/backend/http/types.js'

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

describe('registerFeatureRoutes — api.ts (cũ) và @Controller (mới) chạy song song (#508)', () => {
  test('route statistics đến từ @Controller; feature cũ vẫn đủ route; không còn statistics/api.ts', async () => {
    const app = new Hono<HonoEnv>()
    await registerFeatureRoutes(app)
    const rows = app.routes.map((r) => `${r.method} ${r.path}`)

    expect(rows.filter((r) => r === 'GET /api/statistics/usage')).toHaveLength(1)
    expect(rows).toContain('ALL /api/statistics/usage')
    // app.all viết tay của feature cũ còn nguyên
    expect(rows).toContain('ALL /api/runners')
    expect(rows).toContain('ALL /api/projects')
  })

  test('thứ tự: logs (60) → automations (65) → statistics @Controller (65) → monitor (70); 405 decorator ở cuối', async () => {
    const app = new Hono<HonoEnv>()
    await registerFeatureRoutes(app)
    const rows = app.routes.map((r) => `${r.method} ${r.path}`)
    const idx = (row: string) => rows.indexOf(row)

    const logs = idx('GET /api/jobs/:id/log')
    const stats = idx('GET /api/statistics/usage')
    const monitor = idx('GET /api/tasks')
    const automations = rows.findIndex((r) => r.includes('/api/automations'))
    expect(logs).toBeGreaterThan(-1)
    expect(automations).toBeGreaterThan(logs)
    expect(stats).toBeGreaterThan(automations)
    expect(monitor).toBeGreaterThan(stats)
    expect(idx('ALL /api/statistics/usage')).toBe(rows.length - 1)
  })
})
