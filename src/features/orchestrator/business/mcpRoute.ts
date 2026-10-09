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
  /** Chỉ để log/debug, không đi vào prompt. */
  reason: string
}

/**
 * Chốt tuyến ra lệnh cho một lượt điều phối. Không ném: mọi lỗi rơi về `sentinel`.
 * xem docs/architecture/code/orchestrator.md §9
 */
export function resolveDecisionRoute(): DecisionRouteResult {
  const sentinel = (reason: string): DecisionRouteResult => ({ route: 'sentinel', reason })
  try {
    // xem docs/architecture/code/orchestrator.md §9
    const baseUrl = process.env.DEV_TEAM_SELF_BASE_URL?.trim()
    if (!baseUrl) return sentinel('DEV_TEAM_SELF_BASE_URL chưa set')

    const runner = getDefaultRunner()
    if (!runner) return sentinel('không có default runner')

    const conn = getConnection(runner.connectionId)
    if (!conn) return sentinel(`connection ${runner.connectionId} không tồn tại`)

    if (mcpDeliveryOf(conn.providerId) !== 'config-file-flag') {
      return sentinel(`provider ${conn.providerId} không nhận --mcp-config`)
    }

    if (!canAttachSelfMcp()) return sentinel('không định vị được mcp/stdio.ts')

    return { route: 'mcp', reason: 'dashboard tự gắn MCP server của chính nó' }
  } catch (err: any) {
    return sentinel(`lỗi đọc registry: ${String(err?.message ?? err)}`)
  }
}
