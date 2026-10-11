import type { Context } from 'hono'
import type { HonoEnv } from './types.js'
import type { FormRequest, FormRequestClass } from './FormRequest.js'
import type { AbstractHttpController, RequestScope } from './AbstractHttpController.js'

/**
 * Decorator chuẩn TC39 (stage 3) cho controller HTTP — 🚫 `experimentalDecorators`,
 * 🚫 `reflect-metadata`. Kiểu bị xoá lúc chạy nên Request khai thẳng trong decorator
 * route, business khai ở `inject` của `@Controller`; đổi lại tsc ép chữ ký method khớp
 * Request đã khai (lệch → TS1241).
 *
 * Method decorator ghi vào `context.metadata`; `@Controller` đọc lại và chốt định nghĩa
 * vào một `WeakMap` theo class — `registerControllers` chỉ đọc qua `controllerDefinition`.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** `required` → thiếu root (`?project=` không resolve) trả 404 `unknown project` trước khi validate. */
export type RootRequirement = 'required' | 'optional'

export type RouteOptions = {
  root?: RootRequirement
}

export type RouteDefinition = {
  method: HttpMethod
  path: string
  request: FormRequestClass | null
  root: RootRequirement | undefined
  handler: string | symbol
  raw: boolean
}

export type ControllerOptions<B> = {
  /** Thứ tự đăng ký, sắp chung với `routeOrder` của `api.ts` kiểu cũ (mặc định 100). */
  order?: number
  /** Mặc định của mọi route trong controller; route khai riêng thì route thắng. Mặc định `optional`. */
  root?: RootRequirement
  /** Dựng business theo phạm vi request — đối số của constructor controller. */
  inject?: (scope: RequestScope) => B
}

export type ControllerDefinition = {
  order: number
  root: RootRequirement
  inject: ((scope: RequestScope) => unknown) | null
  routes: RouteDefinition[]
}

type PendingRoute = Omit<RouteDefinition, 'raw'>

const ROUTES = Symbol('httpRoutes')
const RAW = Symbol('httpRaw')

const definitions = new WeakMap<object, ControllerDefinition>()

/** Mảng riêng của class này — metadata lớp con kế thừa prototype của lớp cha, không ghi lẫn sang cha. */
function own<T>(metadata: DecoratorMetadataObject | undefined, key: symbol, init: () => T): T {
  if (!metadata) {
    // Runtime không cấp `context.metadata` (decorator legacy / transpiler cũ) — báo rõ thay vì mất route âm thầm.
    throw new Error('decorator HTTP cần decorator chuẩn TC39 có context.metadata (Bun ≥ 1.3, esbuild ≥ 0.21)')
  }
  if (!Object.prototype.hasOwnProperty.call(metadata, key)) {
    ;(metadata as Record<symbol, unknown>)[key] = init()
  }
  return (metadata as Record<symbol, T>)[key]
}

type ControllerCtor<B> = abstract new (biz: B) => AbstractHttpController

/** `@Controller({ order, root, inject })` — đánh dấu class là controller cho loader. */
export function Controller<B = undefined>(options: ControllerOptions<B> = {}) {
  return function <C extends ControllerCtor<B>>(target: C, context: ClassDecoratorContext<C>): void {
    const metadata = context.metadata
    const pending = metadata && Object.prototype.hasOwnProperty.call(metadata, ROUTES)
      ? ((metadata as Record<symbol, PendingRoute[]>)[ROUTES] ?? [])
      : []
    const raw = metadata && Object.prototype.hasOwnProperty.call(metadata, RAW)
      ? ((metadata as Record<symbol, Set<string | symbol>>)[RAW] ?? new Set())
      : new Set<string | symbol>()
    definitions.set(target, {
      order: options.order ?? 100,
      root: options.root ?? 'optional',
      inject: (options.inject as ((scope: RequestScope) => unknown) | undefined) ?? null,
      routes: pending.map((r) => ({ ...r, raw: raw.has(r.handler) })),
    })
  }
}

/** Định nghĩa đã chốt của một class `@Controller`, hoặc `undefined` nếu không phải. */
export function controllerDefinition(target: unknown): ControllerDefinition | undefined {
  if (typeof target !== 'function') return undefined
  return definitions.get(target)
}

type Ctx = Context<HonoEnv>

/** Handler không khai Request: `()` · `@Raw` → `(c)`. */
type PlainHandler = ((this: AbstractHttpController) => unknown) | ((this: AbstractHttpController, c: Ctx) => unknown)
/** Handler có Request: `(req)` · `@Raw` → `(c, req)`. */
type RequestHandler<R> =
  | ((this: AbstractHttpController, req: R) => unknown)
  | ((this: AbstractHttpController, c: Ctx, req: R) => unknown)

function addRoute(
  context: ClassMethodDecoratorContext,
  method: HttpMethod,
  path: string,
  request: FormRequestClass | null,
  options: RouteOptions | undefined,
): void {
  if (context.static || context.private) {
    throw new Error(`@${method}('${path}') chỉ gắn được trên method public không static`)
  }
  own<PendingRoute[]>(context.metadata, ROUTES, () => []).push({
    method,
    path,
    request,
    root: options?.root,
    handler: context.name,
  })
}

type RouteDecoratorFactory = {
  (path: string, options?: RouteOptions): <M extends PlainHandler>(target: M, context: ClassMethodDecoratorContext<AbstractHttpController, M>) => void
  <R extends FormRequest>(
    path: string,
    request: FormRequestClass<R>,
    options?: RouteOptions,
  ): <M extends RequestHandler<R>>(target: M, context: ClassMethodDecoratorContext<AbstractHttpController, M>) => void
}

function route(method: HttpMethod): RouteDecoratorFactory {
  return ((path: string, second?: FormRequestClass | RouteOptions, third?: RouteOptions) => {
    const request = typeof second === 'function' ? second : null
    const options = typeof second === 'function' ? third : second
    return (_target: unknown, context: ClassMethodDecoratorContext) =>
      addRoute(context, method, path, request, options)
  }) as RouteDecoratorFactory
}

export const Get = route('GET')
export const Post = route('POST')
export const Put = route('PUT')
export const Patch = route('PATCH')
export const Delete = route('DELETE')

/**
 * Lối thoát cho SSE, multipart, `Response` thô: handler nhận Hono `c` làm đối số đầu
 * (`(c)` hoặc `(c, req)`). Dùng chung với một decorator route trên cùng method.
 */
export function Raw<M extends (this: AbstractHttpController, c: Ctx, ...rest: never[]) => unknown>(
  _target: M,
  context: ClassMethodDecoratorContext<AbstractHttpController, M>,
): void {
  own<Set<string | symbol>>(context.metadata, RAW, () => new Set()).add(context.name)
}
