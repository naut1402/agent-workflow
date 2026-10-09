/**
 * Nơi DUY NHẤT trả lời "lượt điều phối này đi tuyến nào".
 *
 * Kết quả được chốt một lần ở `askAgent` ngay trước `submitJob` rồi đóng dấu vào
 * `metadata.orchestratorMcpRoute`; cả prompt lẫn runner đọc lại cùng một giá trị
 * đó. Mọi cách tính lại ở hai nơi đều mở ra cửa sổ "prompt dạy gọi tool nhưng
 * job không có tool" — bất biến này là lý do file tồn tại.
 */
// Qua barrel, 🚫 không import sâu: `feature-architecture-guideline.md` §2.6.
// Ngoại lệ "vòng barrel" không áp dụng — `decisionLoop.ts` (caller của file này)
// và `controller.ts` đã import chính barrel đó mà không sinh vòng.
import {
  canAttachSelfMcp,
  getConnection,
  getDefaultRunner,
  mcpDeliveryOf,
} from '../../runner/business/index.js'

/** `mcp` = ra lệnh bằng tool; `sentinel` = ra lệnh bằng dòng JSON cuối output. */
export type DecisionRoute = 'mcp' | 'sentinel'

export interface DecisionRouteResult {
  route: DecisionRoute
  /** Chỉ để log/debug — 🚫 KHÔNG đi vào prompt. */
  reason: string
}

/**
 * Chốt tuyến cho một lượt điều phối. 🚫 KHÔNG ném trong mọi nhánh: một lỗi đọc
 * file registry không được phép làm chết lượt điều phối, nó chỉ làm lượt đó rơi
 * về `sentinel` — đúng hành vi hôm nay.
 */
export function resolveDecisionRoute(): DecisionRouteResult {
  const sentinel = (reason: string): DecisionRouteResult => ({ route: 'sentinel', reason })
  try {
    // Thiếu biến này thì `buildChildEnv` của claude-code-cli KHÔNG bơm token
    // xuống tiến trình con ⇒ tool chắc chắn 401. Đừng dạy agent gọi một tool
    // chắc chắn hỏng.
    const baseUrl = process.env.DEV_TEAM_SELF_BASE_URL?.trim()
    if (!baseUrl) return sentinel('DEV_TEAM_SELF_BASE_URL chưa set')

    // Job điều phối KHÔNG pin runner (`askAgent` không truyền `runnerId`) nên nó
    // chạy trên đúng `getDefaultRunner()`.
    const runner = getDefaultRunner()
    if (!runner) return sentinel('không có default runner')

    const conn = getConnection(runner.connectionId)
    if (!conn) return sentinel(`connection ${runner.connectionId} không tồn tại`)

    // Chỉ provider claude-style mới nhận `--mcp-config`.
    if (mcpDeliveryOf(conn.providerId) !== 'config-file-flag') {
      return sentinel(`provider ${conn.providerId} không nhận --mcp-config`)
    }

    if (!canAttachSelfMcp()) return sentinel('không định vị được mcp/stdio.ts')

    return { route: 'mcp', reason: 'dashboard tự gắn MCP server của chính nó' }
  } catch (err: any) {
    return sentinel(`lỗi đọc registry: ${String(err?.message ?? err)}`)
  }
}
