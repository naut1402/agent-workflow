import type { z } from 'zod'

/**
 * Wrapper zod cho DTO — một schema vừa validate ở biên HTTP, vừa là nguồn kiểu cho
 * FE · BE · `mcp/`. Thuần type + identity, không hạ tầng (xem `src/shared/README.md`).
 */

/** Kiểu dữ liệu đã validate (đầu ra của schema, sau `default` / `transform`). */
export type Dto<S extends z.ZodTypeAny> = z.output<S>

/** Kiểu dữ liệu trước validate (đầu vào của schema — vd body FE gửi lên). */
export type DtoInput<S extends z.ZodTypeAny> = z.input<S>

/**
 * Khai một DTO. Trả lại đúng schema — giá trị nằm ở chỗ đánh dấu "đây là hợp đồng
 * dữ liệu dùng chung", để người đọc phân biệt với schema con chỉ dùng nội bộ.
 */
export function defineDto<S extends z.ZodTypeAny>(schema: S): S {
  return schema
}
