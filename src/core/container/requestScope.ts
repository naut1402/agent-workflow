import { createToken, type ContainerToken } from './index'
import type { RegistryContext } from '../registry'

/**
 * Dữ liệu per-request mà child scope mang theo. Factory root-scoped của feature
 * đọc `root` từ đây thay vì đóng gói `Context` của Hono vào business layer.
 */
export type RequestScope = {
  /** Root `.dev-team-agent/` đã resolve từ `?project=` — `null` khi không resolve được. */
  root: string | null
  projectId: string | null
  ctx: RegistryContext
}

/**
 * Token duy nhất mang `RequestScope`. Chỉ đăng ký ở **child scope** (mỗi request);
 * resolve token này từ root container sẽ throw "chưa đăng ký" — đúng ý đồ.
 */
export const requestScopeToken: ContainerToken<RequestScope> =
  createToken<RequestScope>('requestScope')
