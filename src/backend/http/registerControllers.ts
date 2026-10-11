import type { Context, Hono } from 'hono'
import type { HonoEnv } from './types.js'
import { j, parseBody, unknownProject } from './responseHelper.js'
import type { FormRequest, FormRequestClass } from './FormRequest.js'
import { JsonResult, SCOPE, type AbstractHttpController, type RequestScope } from './AbstractHttpController.js'
import { controllerDefinition, type ControllerDefinition, type RouteDefinition } from './decorators.js'

/**
 * Gắn controller kiểu decorator vào Hono. Mỗi request:
 *
 * root (route `required` thiếu root → 404 `unknown project`) → validate FormRequest
 * (400 `invalid JSON` / `invalid` / chuỗi của `after()`) → dựng business qua `inject(scope)`
 * → dựng controller → gọi handler → object thành 200 JSON, `JsonResult` thành status riêng,
 * `Response` trả nguyên. JSON luôn kèm `Cache-Control: no-store`.
 *
 * Sau route của mọi controller, mỗi path đã khai được thêm `app.all` → 405
 * `{ error: 'method not allowed' }` cho method không khai (thay `app.all` viết tay).
 */

type ControllerClass = new (biz: unknown) => AbstractHttpController

export function isControllerClass(value: unknown): value is ControllerClass {
  return controllerDefinition(value) !== undefined
}

/** Thứ tự đăng ký của controller (mặc định 100) — sắp chung với `routeOrder` của `api.ts`. */
export function controllerOrder(value: unknown): number {
  return controllerDefinition(value)?.order ?? 100
}

function scopeOf(c: Context<HonoEnv>): RequestScope {
  return { root: c.get('root'), projectId: c.get('projectId'), ctx: c.get('ctx') }
}

async function readRaw(c: Context<HonoEnv>, request: FormRequestClass): Promise<{ raw: unknown } | { error: Response }> {
  switch (request.source) {
    case 'body': {
      const parsed = await parseBody(c)
      if (!parsed.ok) return { error: j(c, 400, { error: 'invalid JSON' }) }
      return { raw: parsed.value }
    }
    case 'params':
      return { raw: c.req.param() }
    case 'query':
    default:
      return { raw: c.req.query() }
  }
}

async function buildRequest(
  c: Context<HonoEnv>,
  RequestClass: FormRequestClass,
): Promise<{ req: FormRequest } | { error: Response }> {
  const read = await readRaw(c, RequestClass)
  if ('error' in read) return read
  const req = new RequestClass()
  // Body JSON có thể không phải object (mảng, chuỗi) — chuyển nguyên cho schema bắt lỗi.
  const prepared = req.prepare(read.raw as Record<string, unknown>)
  const parsed = RequestClass.schema.safeParse(prepared)
  if (!parsed.success) return { error: j(c, 400, { error: RequestClass.invalid }) }
  req.data = parsed.data
  const afterError = req.after()
  if (afterError !== null) return { error: j(c, 400, { error: afterError }) }
  return { req }
}

function toResponse(c: Context<HonoEnv>, result: unknown): Response {
  if (result instanceof Response) return result
  if (result instanceof JsonResult) return j(c, result.status, result.body)
  return j(c, 200, result ?? null)
}

function handlerFor(Ctor: ControllerClass, def: ControllerDefinition, route: RouteDefinition) {
  const needsRoot = (route.root ?? def.root) === 'required'
  return async (c: Context<HonoEnv>): Promise<Response> => {
    const scope = scopeOf(c)
    if (needsRoot && !scope.root) return unknownProject(c)

    let req: FormRequest | undefined
    if (route.request) {
      const built = await buildRequest(c, route.request)
      if ('error' in built) return built.error
      req = built.req
    }

    const ctrl = new Ctor(def.inject ? def.inject(scope) : undefined)
    ctrl[SCOPE] = scope
    const fn = (ctrl as unknown as Record<string | symbol, unknown>)[route.handler]
    if (typeof fn !== 'function') {
      throw new Error(`Controller method not found: ${Ctor.name}.${String(route.handler)}`)
    }
    const args = route.raw ? (req ? [c, req] : [c]) : req ? [req] : []
    return toResponse(c, await fn.apply(ctrl, args))
  }
}

/**
 * Gắn route của một controller theo thứ tự khai. Trả về các path đã khai (không trùng) để
 * caller gắn 405 bằng `registerMethodNotAllowed` **sau** mọi route — path dùng chung giữa
 * hai controller (GET ở cái này, POST ở cái kia) không bị 405 của cái trước che mất.
 */
export function registerController(app: Hono<HonoEnv>, Ctor: unknown): string[] {
  const def = controllerDefinition(Ctor)
  if (!def) throw new Error(`registerController: ${String((Ctor as { name?: string })?.name ?? Ctor)} không có @Controller`)
  const Klass = Ctor as ControllerClass
  const paths: string[] = []
  for (const route of def.routes) {
    app.on(route.method, route.path, handlerFor(Klass, def, route))
    if (!paths.includes(route.path)) paths.push(route.path)
  }
  return paths
}

/** 405 `{ error: 'method not allowed' }` cho method không khai trên các path đã khai. */
export function registerMethodNotAllowed(app: Hono<HonoEnv>, paths: Iterable<string>): void {
  for (const path of new Set(paths)) app.all(path, (c) => j(c, 405, { error: 'method not allowed' }))
}

/**
 * Gắn nhiều controller, sắp theo `order` (ổn định — cùng order giữ thứ tự truyền vào),
 * rồi 405 cho mọi path đã khai.
 */
export function registerControllers(app: Hono<HonoEnv>, controllers: readonly unknown[]): void {
  const sorted = controllers
    .map((Ctor, index) => ({ Ctor, index, order: controllerOrder(Ctor) }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
  const paths: string[] = []
  for (const { Ctor } of sorted) paths.push(...registerController(app, Ctor))
  registerMethodNotAllowed(app, paths)
}
