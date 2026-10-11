import type { z } from 'zod'
import type { Dto } from '../../shared/type/dto.js'

/** Phần request mà FormRequest đọc làm dữ liệu thô. */
export type RequestSource = 'query' | 'body' | 'params'

/**
 * Request có validate, khai trong `features/<f>/controller.ts` (theo kiểu FormRequest
 * của Laravel). `registerControllers` chạy theo thứ tự:
 *
 * 1. Đọc dữ liệu thô theo `source` (`body` không phải JSON → 400 `invalid JSON`).
 * 2. `prepare(raw)` — map tên trên dây sang tên DTO (`task` → `taskId`), bỏ chuỗi rỗng…
 * 3. `schema.safeParse` — fail → 400 `{ error: invalid }`.
 * 4. Gán `data`, gọi `after()` — luật chéo field; trả chuỗi → 400 `{ error: <chuỗi> }`.
 *
 * Lớp con khai `static schema` / `static invalid` (và `static source` nếu không phải
 * query), rồi truyền chính lớp đó vào `@Get(path, XRequest)`.
 */
export abstract class FormRequest<S extends z.ZodTypeAny = z.ZodTypeAny> {
  static schema: z.ZodTypeAny
  static source: RequestSource = 'query'
  /** Chuỗi lỗi 400 khi schema không khớp — giữ nguyên văn chuỗi cũ khi chuyển route. */
  static invalid = 'invalid request'

  /** Dữ liệu đã validate — chỉ có sau bước 3. */
  data!: Dto<S>

  /** Map dữ liệu thô trước khi validate. Mặc định giữ nguyên. */
  prepare(raw: Record<string, unknown>): unknown {
    return raw
  }

  /** Luật chéo field sau validate: trả chuỗi lỗi (400) hoặc `null`. */
  after(): string | null {
    return null
  }
}

/** Lớp FormRequest cụ thể (không abstract) — thứ truyền vào decorator route. */
export type FormRequestClass<R extends FormRequest = FormRequest> = {
  new (): R
  schema: z.ZodTypeAny
  source: RequestSource
  invalid: string
}
