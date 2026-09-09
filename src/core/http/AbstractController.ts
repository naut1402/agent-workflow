import type { Context, Handler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { HonoEnv, RegistryContext } from './types.js'

/**
 * Base cho mọi feature controller (server-side).
 * FE không import module này — chỉ features/<name>/controller.ts và api.ts.
 */
export abstract class AbstractController {
  constructor(protected readonly c: Context<HonoEnv>) {}

  protected get root(): string | null {
    return this.c.get('root')
  }

  protected get projectId(): string | null {
    return this.c.get('projectId')
  }

  protected get ctx(): RegistryContext {
    return this.c.get('ctx')
  }

  /** JSON + Cache-Control: no-store (dashboard poll). */
  protected json(status: number, body: unknown): Response {
    this.c.header('Cache-Control', 'no-store')
    return this.c.json(body as never, status as ContentfulStatusCode)
  }

  protected ok(body: unknown): Response {
    return this.json(200, body)
  }

  protected created(body: unknown): Response {
    return this.json(201, body)
  }

  protected badRequest(error: string, extra?: Record<string, unknown>): Response {
    return this.json(400, { error, ...extra })
  }

  protected notFound(error: string, extra?: Record<string, unknown>): Response {
    return this.json(404, { error, ...extra })
  }

  protected methodNotAllowed(): Response {
    return this.json(405, { error: 'method not allowed' })
  }

  /** 404 khi `?project=` không resolve được root. */
  protected unknownProject(): Response {
    return this.json(404, { error: 'unknown project', project: this.projectId })
  }

  /**
   * Root bắt buộc. Discriminant: có `error` → đã có Response 404;
   * không thì `root` là string (narrow bằng `'error' in …`).
   */
  protected requireRoot(): { root: string } | { error: Response } {
    const root = this.root
    if (!root) return { error: this.unknownProject() }
    return { root }
  }

  protected async parseBody(): Promise<{ ok: true; value: any } | { ok: false }> {
    try {
      return { ok: true, value: JSON.parse(await this.c.req.text()) }
    } catch {
      return { ok: false }
    }
  }

  protected async requireJsonBody(): Promise<{ value: any } | { error: Response }> {
    const b = await this.parseBody()
    if (!b.ok) return { error: this.badRequest('invalid JSON') }
    return { value: b.value }
  }
}

type ControllerCtor<C extends AbstractController> = new (c: Context<HonoEnv>) => C

/**
 * Gắn method controller vào Hono handler (một instance / request).
 * Dùng trong features/<name>/api.ts.
 */
export function bind<C extends AbstractController>(
  Ctor: ControllerCtor<C>,
  method: keyof C & string,
): Handler<HonoEnv> {
  return (c) => {
    const ctrl = new Ctor(c)
    const fn = ctrl[method]
    if (typeof fn !== 'function') {
      throw new Error(`Controller method not found: ${Ctor.name}.${method}`)
    }
    return (fn as (this: C) => Response | Promise<Response>).call(ctrl)
  }
}
