import type { RegistryContext } from './types.js'

/** Phạm vi của một request — đầu vào của `inject` và của `this.scope` trong handler. */
export type RequestScope = {
  root: string | null
  projectId: string | null
  ctx: RegistryContext
}

/** Kết quả JSON có status riêng — `registerControllers` trả kèm `Cache-Control: no-store`. */
export class JsonResult {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {}
}

/** Khoá dispatcher dùng để gắn scope sau khi dựng controller (constructor chỉ nhận business). */
export const SCOPE = Symbol('requestScope')

/**
 * Base cho controller kiểu decorator (`@Controller` + `@Get/@Post…`).
 *
 * Constructor nhận business do `inject(scope)` của `@Controller` dựng — một instance mỗi
 * request. Handler trả object (→ 200 JSON), `this.fail(…)` / `this.json(…)` (status khác),
 * hoặc `Response` thô. Kiểu cũ (`api.ts` + `bind()`) vẫn dùng `AbstractController`.
 */
export abstract class AbstractHttpController {
  /** Gắn bởi `registerControllers` trước khi gọi handler. */
  [SCOPE]!: RequestScope

  protected get scope(): RequestScope {
    return this[SCOPE]
  }

  /** JSON với status bất kỳ (201, 202…). */
  protected json(status: number, body: unknown): JsonResult {
    return new JsonResult(status, body)
  }

  /** Lỗi `{ error, ...extra }` — chuỗi `error` giữ nguyên văn chuỗi cũ khi chuyển route. */
  protected fail(status: number, error: string, extra?: Record<string, unknown>): JsonResult {
    return new JsonResult(status, { error, ...extra })
  }
}
