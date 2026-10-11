import { describe, expect, test } from 'bun:test'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import type { HonoEnv, RegistryContext } from '../../../../src/backend/http/types.js'
import { AbstractHttpController } from '../../../../src/backend/http/AbstractHttpController.js'
import { FormRequest } from '../../../../src/backend/http/FormRequest.js'
import {
  Controller,
  controllerDefinition,
  Delete,
  Get,
  Patch,
  Post,
  Put,
  Raw,
} from '../../../../src/backend/http/decorators.js'
import {
  controllerOrder,
  isControllerClass,
  registerController,
  registerControllers,
} from '../../../../src/backend/http/registerControllers.js'

/**
 * #508 — controller kiểu decorator: `@Controller` + `@Get/@Post…` + `FormRequest` + `inject`.
 * App test dựng lại middleware root của `createApp`: `?project=known` → root `/root/known`,
 * không có `?project=` → root mặc định, `?project=` lạ → root `null`.
 */

const fakeCtx = { tag: 'ctx' } as unknown as RegistryContext

function makeApp(): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>()
  app.use('*', async (c, next) => {
    const projectId = c.req.query('project') || null
    c.set('ctx', fakeCtx)
    c.set('projectId', projectId)
    c.set('root', projectId === null ? '/root/default' : projectId === 'known' ? '/root/known' : null)
    await next()
  })
  return app
}

// ── Request ─────────────────────────────────────────────────────────────

const RangeSchema = z.object({ from: z.coerce.number().int(), to: z.coerce.number().int(), label: z.string().optional() })

class RangeRequest extends FormRequest<typeof RangeSchema> {
  static schema = RangeSchema
  static invalid = 'invalid range query'

  /** Tên trên dây `start` / `end` → `from` / `to`. */
  prepare(raw: Record<string, unknown>) {
    return { from: raw.start, to: raw.end, label: raw.label || undefined }
  }

  after(): string | null {
    return this.data.from > this.data.to ? 'invalid to' : null
  }
}

const ItemBody = z.object({ name: z.string().min(1) })
class ItemBodyRequest extends FormRequest<typeof ItemBody> {
  static schema = ItemBody
  static source = 'body' as const
  static invalid = 'invalid item'
}

const IdParams = z.object({ id: z.string().regex(/^\d+$/) })
class IdParamsRequest extends FormRequest<typeof IdParams> {
  static schema = IdParams
  static source = 'params' as const
  static invalid = 'invalid id'
}

// ── Controller mẫu ──────────────────────────────────────────────────────

class FakeBusiness {
  constructor(readonly root: string | null) {}
  describe() {
    return { root: this.root }
  }
}

const injected: Array<string | null> = []

@Controller({
  order: 20,
  inject: (scope) => {
    injected.push(scope.root)
    return new FakeBusiness(scope.root)
  },
})
class ItemController extends AbstractHttpController {
  constructor(private readonly biz: FakeBusiness) {
    super()
  }

  @Get('/api/items')
  list() {
    return { ...this.biz.describe(), projectId: this.scope.projectId, ctx: this.scope.ctx === fakeCtx }
  }

  @Post('/api/items', ItemBodyRequest)
  create(req: ItemBodyRequest) {
    return this.json(201, { created: req.data.name })
  }

  @Get('/api/items/range', RangeRequest)
  range(req: RangeRequest) {
    return { from: req.data.from, to: req.data.to, label: req.data.label ?? null }
  }

  // Path cụ thể khai TRƯỚC `/:id` — Hono khớp theo thứ tự đăng ký.
  @Raw
  @Get('/api/items/raw')
  raw(c: Context<HonoEnv>) {
    return c.text(`raw:${c.get('projectId') ?? 'none'}`, 202)
  }

  @Raw
  @Get('/api/items/raw-range', RangeRequest)
  rawRange(c: Context<HonoEnv>, req: RangeRequest) {
    return new Response(`${req.data.from}-${req.data.to}:${c.req.path}`, { status: 200 })
  }

  @Get('/api/items/:id', IdParamsRequest)
  show(req: IdParamsRequest) {
    if (req.data.id === '0') return this.fail(404, 'item not found', { id: req.data.id })
    return { id: req.data.id }
  }

  @Put('/api/items/:id', IdParamsRequest)
  replace(req: IdParamsRequest) {
    return { replaced: req.data.id }
  }

  @Patch('/api/items/:id', IdParamsRequest)
  patch(req: IdParamsRequest) {
    return { patched: req.data.id }
  }

  @Delete('/api/items/:id', IdParamsRequest, { root: 'required' })
  remove(req: IdParamsRequest) {
    return { deleted: req.data.id, root: this.biz.root }
  }
}

@Controller({ order: 10, root: 'required' })
class ProjectController extends AbstractHttpController {
  @Get('/api/scoped')
  scoped() {
    return { root: this.scope.root }
  }

  @Get('/api/scoped/no-result')
  nothing() {
    return undefined
  }
}

@Controller({ order: 10 })
class SameOrderController extends AbstractHttpController {
  @Get('/api/same-order')
  same() {
    return { ok: 1 }
  }
}

class NotAController extends AbstractHttpController {
  hello() {
    return {}
  }
}

function appWithAll(): Hono<HonoEnv> {
  const app = makeApp()
  registerControllers(app, [ItemController, ProjectController, SameOrderController])
  return app
}

// ── Kiểm tra kiểu (vue-tsc): method lệch Request đã khai → TS1241 ───────────

@Controller()
class TypeCheckController extends AbstractHttpController {
  // @ts-expect-error — handler nhận RangeRequest nhưng route khai IdParamsRequest
  @Get('/api/type/mismatch', IdParamsRequest)
  mismatch(req: RangeRequest) {
    return req.data
  }

  // @ts-expect-error — @Raw bắt buộc đối số đầu là Hono Context
  @Raw
  @Get('/api/type/raw', RangeRequest)
  notRaw(req: RangeRequest) {
    return req
  }

  // @ts-expect-error — route không khai Request thì handler không nhận req
  @Get('/api/type/plain')
  plain(req: RangeRequest) {
    return req
  }
}

describe('decorators — định nghĩa controller', () => {
  test('@Controller chốt order, root, routes theo thứ tự khai; class thường thì không', () => {
    const def = controllerDefinition(ItemController)!
    expect(def.order).toBe(20)
    expect(def.root).toBe('optional')
    expect(def.routes.map((r) => `${r.method} ${r.path} ${String(r.handler)}${r.raw ? ' raw' : ''}`)).toEqual([
      'GET /api/items list',
      'POST /api/items create',
      'GET /api/items/range range',
      'GET /api/items/raw raw raw',
      'GET /api/items/raw-range rawRange raw',
      'GET /api/items/:id show',
      'PUT /api/items/:id replace',
      'PATCH /api/items/:id patch',
      'DELETE /api/items/:id remove',
    ])
    expect(controllerDefinition(NotAController)).toBeUndefined()
    expect(isControllerClass(ItemController)).toBe(true)
    expect(isControllerClass(NotAController)).toBe(false)
    expect(isControllerClass({})).toBe(false)
    expect(controllerOrder(ProjectController)).toBe(10)
    expect(controllerOrder(TypeCheckController)).toBe(100)
  })

  test('registerController từ chối class không có @Controller', () => {
    expect(() => registerController(makeApp(), NotAController)).toThrow(/@Controller/)
  })
})

describe('registerControllers — thứ tự route', () => {
  test('sắp theo order; cùng order giữ thứ tự truyền vào; 405 gắn sau route của mọi controller', () => {
    const paths = appWithAll()
      .routes.filter((r) => r.path !== '/*') // bỏ middleware root
      .map((r) => `${r.method} ${r.path}`)
    expect(paths).toEqual([
      'GET /api/scoped',
      'GET /api/scoped/no-result',
      'GET /api/same-order',
      'GET /api/items',
      'POST /api/items',
      'GET /api/items/range',
      'GET /api/items/raw',
      'GET /api/items/raw-range',
      'GET /api/items/:id',
      'PUT /api/items/:id',
      'PATCH /api/items/:id',
      'DELETE /api/items/:id',
      'ALL /api/scoped',
      'ALL /api/scoped/no-result',
      'ALL /api/same-order',
      'ALL /api/items',
      'ALL /api/items/range',
      'ALL /api/items/raw',
      'ALL /api/items/raw-range',
      'ALL /api/items/:id',
    ])
  })
})

describe('registerControllers — dispatch', () => {
  test('object → 200 JSON + Cache-Control: no-store; business inject theo root của request', async () => {
    injected.length = 0
    const app = appWithAll()
    const res = await app.request('/api/items')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ root: '/root/default', projectId: null, ctx: true })

    const known = await app.request('/api/items?project=known')
    expect(await known.json()).toEqual({ root: '/root/known', projectId: 'known', ctx: true })
    expect(injected).toEqual(['/root/default', '/root/known'])
  })

  test('handler trả undefined → 200 null', async () => {
    const res = await appWithAll().request('/api/scoped/no-result')
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })

  test('query: prepare map tên trên dây, schema coerce, data đã validate tới handler', async () => {
    const res = await appWithAll().request('/api/items/range?start=1&end=5&label=')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ from: 1, to: 5, label: null })
  })

  test('schema fail → 400 đúng chuỗi invalid, no-store, không dựng business', async () => {
    injected.length = 0
    const res = await appWithAll().request('/api/items/range?start=x&end=5')
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ error: 'invalid range query' })
    expect(injected).toEqual([])
  })

  test('after() trả chuỗi → 400 với đúng chuỗi đó', async () => {
    const res = await appWithAll().request('/api/items/range?start=9&end=5')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid to' })
  })

  test('body: JSON hỏng → 400 invalid JSON; schema fail → invalid; hợp lệ → JsonResult 201', async () => {
    const app = appWithAll()
    const bad = await app.request('/api/items', { method: 'POST', body: '{nope' })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'invalid JSON' })

    const empty = await app.request('/api/items', { method: 'POST' })
    expect(empty.status).toBe(400)
    expect(await empty.json()).toEqual({ error: 'invalid JSON' })

    const invalid = await app.request('/api/items', { method: 'POST', body: JSON.stringify({ name: '' }) })
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toEqual({ error: 'invalid item' })

    const notObject = await app.request('/api/items', { method: 'POST', body: '"str"' })
    expect(notObject.status).toBe(400)
    expect(await notObject.json()).toEqual({ error: 'invalid item' })

    const ok = await app.request('/api/items', { method: 'POST', body: JSON.stringify({ name: 'a' }) })
    expect(ok.status).toBe(201)
    expect(ok.headers.get('cache-control')).toBe('no-store')
    expect(await ok.json()).toEqual({ created: 'a' })
  })

  test('params: validate path param; this.fail → status + { error, ...extra }', async () => {
    const app = appWithAll()
    expect(await (await app.request('/api/items/42')).json()).toEqual({ id: '42' })

    const bad = await app.request('/api/items/abc')
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'invalid id' })

    const missing = await app.request('/api/items/0')
    expect(missing.status).toBe(404)
    expect(missing.headers.get('cache-control')).toBe('no-store')
    expect(await missing.json()).toEqual({ error: 'item not found', id: '0' })

    expect(await (await app.request('/api/items/7', { method: 'PUT' })).json()).toEqual({ replaced: '7' })
    expect(await (await app.request('/api/items/7', { method: 'PATCH' })).json()).toEqual({ patched: '7' })
  })

  test('@Raw: handler nhận Hono c, Response trả nguyên (không ép JSON)', async () => {
    const app = appWithAll()
    const res = await app.request('/api/items/raw?project=known')
    expect(res.status).toBe(202)
    expect(await res.text()).toBe('raw:known')

    const ranged = await app.request('/api/items/raw-range?start=2&end=3')
    expect(ranged.status).toBe(200)
    expect(await ranged.text()).toBe('2-3:/api/items/raw-range')

    const invalid = await app.request('/api/items/raw-range?start=5&end=3')
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toEqual({ error: 'invalid to' })
  })
})

describe('registerControllers — 404 unknown project', () => {
  test('controller root required: thiếu root → 404 { error, project } trước khi chạy handler', async () => {
    const app = appWithAll()
    const res = await app.request('/api/scoped?project=ghost')
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ error: 'unknown project', project: 'ghost' })

    expect(await (await app.request('/api/scoped?project=known')).json()).toEqual({ root: '/root/known' })
  })

  test('route root required trong controller optional; kiểm root trước validate', async () => {
    injected.length = 0
    const app = appWithAll()
    const res = await app.request('/api/items/not-a-number?project=ghost', { method: 'DELETE' })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'unknown project', project: 'ghost' })
    expect(injected).toEqual([])

    const ok = await app.request('/api/items/3?project=known', { method: 'DELETE' })
    expect(await ok.json()).toEqual({ deleted: '3', root: '/root/known' })

    // route optional cùng controller vẫn chạy khi root null
    const optional = await app.request('/api/items?project=ghost')
    expect(optional.status).toBe(200)
    expect(await optional.json()).toEqual({ root: null, projectId: 'ghost', ctx: true })
  })
})

describe('registerControllers — 405 tự sinh', () => {
  test('method không khai trên path đã khai → 405 method not allowed + no-store', async () => {
    const app = appWithAll()
    for (const [path, method] of [
      ['/api/items', 'DELETE'],
      ['/api/items/range', 'POST'],
      ['/api/items/5', 'POST'],
      ['/api/scoped', 'PUT'],
    ] as const) {
      const res = await app.request(path, { method })
      expect(res.status).toBe(405)
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(await res.json()).toEqual({ error: 'method not allowed' })
    }
  })

  test('path không khai → không bị 405 (rơi xuống notFound của app)', async () => {
    const app = appWithAll()
    app.notFound((c) => c.json({ error: 'unknown endpoint' }, 404))
    const res = await app.request('/api/items/1/sub', { method: 'POST' })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'unknown endpoint' })
  })

  test('path dùng chung giữa hai controller: 405 của cái trước không che method của cái sau', async () => {
    @Controller({ order: 1 })
    class First extends AbstractHttpController {
      @Get('/api/shared')
      get() {
        return { from: 'first' }
      }
    }
    @Controller({ order: 2 })
    class Second extends AbstractHttpController {
      @Post('/api/shared')
      post() {
        return { from: 'second' }
      }
    }
    const app = makeApp()
    registerControllers(app, [Second, First])
    expect(await (await app.request('/api/shared')).json()).toEqual({ from: 'first' })
    expect(await (await app.request('/api/shared', { method: 'POST' })).json()).toEqual({ from: 'second' })
    expect((await app.request('/api/shared', { method: 'DELETE' })).status).toBe(405)
  })
})
