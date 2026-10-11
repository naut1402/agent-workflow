// xem docs/architecture/code/orchestrator.md §1
import { SelfMcpServer } from '../../mcp/business/index.js'
import { getConnection, getDefaultRunner, getProvider } from '../../runner/business/index.js'

/** `mcp` = ra lệnh bằng tool; `sentinel` = ra lệnh bằng dòng JSON cuối output. */
export type DecisionRoute = 'mcp' | 'sentinel'

export interface DecisionRouteResult {
  route: DecisionRoute
  /** Chỉ để log/debug — không đi vào prompt. */
  reason: string
}

/** Chốt tuyến cho một lượt điều phối — không ném; lỗi nào cũng rơi về `sentinel`. */
export function resolveDecisionRoute(): DecisionRouteResult {
  const sentinel = (reason: string): DecisionRouteResult => ({ route: 'sentinel', reason })
  try {
    const baseUrl = SelfMcpServer.selfBaseUrl()?.trim()
    if (!baseUrl) return sentinel('DEV_TEAM_SELF_BASE_URL chưa set')

    const runner = getDefaultRunner()
    if (!runner) return sentinel('không có default runner')

    const conn = getConnection(runner.connectionId)
    if (!conn) return sentinel(`connection ${runner.connectionId} không tồn tại`)

    if (!getProvider(conn.providerId)?.mcpDelivery?.acceptsSelfServer) {
      return sentinel(`provider ${conn.providerId} không nhận --mcp-config`)
    }

    if (!SelfMcpServer.canAttach()) return sentinel('không định vị được mcp/stdio.ts')

    return { route: 'mcp', reason: 'dashboard tự gắn MCP server của chính nó' }
  } catch (err: any) {
    return sentinel(`lỗi đọc registry: ${String(err?.message ?? err)}`)
  }
}
