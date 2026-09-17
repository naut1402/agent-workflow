import { randomBytes } from 'node:crypto'
import type { TaskRef } from './decisionLoop.js'

/**
 * Token → `TaskRef` cho route MCP-over-HTTP của orchestrator (`/api/mcp/orchestrator`).
 *
 * Vòng đời gắn với job: mint lúc `askAgent()` submit job quyết định, revoke khi
 * job đó xong/lỗi hoặc orchestrator halt (bằng nút Stop hoặc tự quyết `halt`) —
 * xem `decisionLoop.ts`. Không dùng JWT: kênh này không có caller bên ngoài hợp
 * lệ nào khác ngoài chính child process do server tự spawn, và token tra thẳng
 * ra scope (`root`/`taskId`) mà JWT không tự mang (§3.3 design.md).
 */
const tokens = new Map<string, TaskRef>()

export function mintMcpToken(ref: TaskRef): string {
  const token = randomBytes(24).toString('base64url')
  tokens.set(token, ref)
  return token
}

export function resolveMcpToken(token: string): TaskRef | null {
  return tokens.get(token) ?? null
}

export function revokeMcpTokensFor(ref: { root: string; taskId: string }): void {
  for (const [token, r] of tokens) {
    if (r.root === ref.root && r.taskId === ref.taskId) tokens.delete(token)
  }
}
