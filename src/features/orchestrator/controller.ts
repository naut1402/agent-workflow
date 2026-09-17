import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { AbstractController } from '../../backend/http/AbstractController.js'
import { resolveMcpToken } from './business/mcpTokens.js'
import { createOrchestratorMcpServer } from './business/mcpTools.js'

/** Header riêng cho token MCP của orchestrator — KHÔNG dùng `Authorization`, tránh
 * `createJwtMiddleware()` (đọc `Authorization` cho JWT dashboard) chặn nhầm.
 * Tên header case-insensitive theo chuẩn HTTP — phải khớp giá trị được
 * `claude-code-cli.ts` truyền vào `--mcp-config` cho `claude` CLI. */
export const MCP_TOKEN_HEADER = 'X-Dashboard-Orchestrator-Token'

export class OrchestratorController extends AbstractController {
  /**
   * Route MCP-over-HTTP cho `claude` CLI đóng vai orchestrator gọi ngược vào
   * chính server này (§3.1/§4.2 design.md). KHÔNG dành cho người dùng cuối —
   * xác thực bằng token 1-lần/1-job (`mcpTokens.ts`), không phải JWT dashboard.
   *
   * Stateless mode (`sessionIdGenerator: undefined`): mỗi request tự đủ, không
   * giữ gì giữa các lần gọi tool trong cùng một lượt — `ref` luôn resolve lại
   * từ token.
   */
  async handleMcp(): Promise<Response> {
    const token = this.c.req.header(MCP_TOKEN_HEADER)
    const ref = token ? resolveMcpToken(token) : null
    if (!ref) return this.json(401, { error: 'invalid or expired orchestrator token' })

    const server = createOrchestratorMcpServer(ref)
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    await server.connect(transport)
    return transport.handleRequest(this.c.req.raw)
  }
}
