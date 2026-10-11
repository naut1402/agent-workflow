import {
  McpClient,
  SecretMasker,
  type CredentialResolver,
  type McpServerSet,
  type McpSession,
} from '../../../mcp/business/index.js'
import { McpJobDelivery, type McpJobInput } from './McpJobDelivery.js'

const MCP_TOOL_PREFIX = 'mcp__'
/** Hạn mặc định của một lời gọi tool. */
export const MCP_TOOL_CALL_TIMEOUT_MS = 60_000

export interface McpBridgeTool {
  name: string
  description: string
  inputSchema: unknown
}

interface McpToolCallOutcome {
  ok: boolean
  error?: string
  result?: unknown
}

export interface McpToolBridge {
  tools: McpBridgeTool[]
  /** Giá trị cần mask trước khi ghi kết quả tool / lỗi vào log job. */
  masker: SecretMasker
  has(name: string): boolean
  call(name: string, args: Record<string, unknown>): Promise<McpToolCallOutcome>
  close(): Promise<void>
}

// xem docs/architecture/code/runner.md §23
/** Giao MCP cho họ `ai-api`: dashboard tự mở phiên MCP và khai tool vào vòng tool-use; `null` khi không có server nào. */
export class ToolBridgeMcpDelivery extends McpJobDelivery<McpToolBridge> {
  readonly kind = 'bridge-tools' as const

  /**
   * @param credentials giải `credentialId` của server từ xa thành secret.
   * @param callTimeoutMs hạn mỗi lời gọi tool — tiêm từ test.
   */
  constructor(
    private readonly credentials: CredentialResolver,
    private readonly callTimeoutMs: number = MCP_TOOL_CALL_TIMEOUT_MS,
  ) {
    super()
  }

  protected async attach(set: McpServerSet, input: McpJobInput): Promise<McpToolBridge | null> {
    const warn = (message: string) => input.onWarning?.(message)
    const sessions = new Map<string, McpSession>()
    const routes = new Map<string, { session: McpSession; toolName: string }>()
    const tools: McpBridgeTool[] = []
    let collected = SecretMasker.NONE

    for (const server of set.servers) {
      const key = server.key
      if (!key) {
        warn(`mcp ${server.id}: id không hợp lệ — bỏ qua server này`)
        continue
      }
      // xem docs/architecture/code/runner.md §23
      const credentialSecret = server.resolve({ credentials: this.credentials }).secret
      const knownMasker = new SecretMasker([
        ...server.secretValues(),
        ...(credentialSecret ? [credentialSecret] : []),
      ])

      let session: McpSession
      try {
        session = await McpClient.open(server, {
          cwd: input.workspace,
          onWarning: (message) => warn(`mcp ${server.id}: ${message}`),
          // xem docs/architecture/code/runner.md §23
          credentials: this.credentials,
        })
      } catch (err: any) {
        warn(`mcp ${server.id}: không mở được phiên — ${knownMasker.mask(String(err?.message ?? err))}`)
        continue
      }
      sessions.set(key, session)
      collected = collected.with(session.masker.values, knownMasker.values)
      for (const tool of session.tools) {
        if (!tool.name) continue
        const name = `${MCP_TOOL_PREFIX}${key}__${tool.name}`
        routes.set(name, { session, toolName: tool.name })
        tools.push({ name, description: tool.description, inputSchema: tool.inputSchema ?? { type: 'object' } })
      }
    }

    if (!sessions.size) return null

    const masker = collected
    const timeoutMs = this.callTimeoutMs
    return {
      tools,
      masker,
      has: (name) => routes.has(name),
      async call(name, args) {
        const route = routes.get(name)
        if (!route) return { ok: false, error: `tool ${name} không tồn tại` }
        try {
          const result = await McpClient.withTimeout(
            route.session.callTool(route.toolName, args ?? {}),
            timeoutMs,
            `mcp: tool ${name} quá hạn ${timeoutMs}ms`,
          )
          // xem docs/architecture/code/runner.md §23
          return { ok: true, result: masker.maskDeep(result) }
        } catch (err: any) {
          return { ok: false, error: masker.mask(String(err?.message ?? err)) }
        }
      },
      async close() {
        for (const session of sessions.values()) {
          await session.close().catch(() => {})
        }
        sessions.clear()
        routes.clear()
      },
    }
  }
}
