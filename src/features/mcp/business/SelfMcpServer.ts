// xem docs/mcp/server.md §8.1
import { dirnameFromImportMeta, existsSync, resolvePath } from '../../../backend/lib/fileHelper.js'
import type { McpStdioServer } from '../schemas/mcpServer.js'
import { StdioMcpServer } from './StdioMcpServer.js'

type JobMetadata = Record<string, unknown> | undefined

export class SelfMcpServer extends StdioMcpServer {
  /** Khoá entry trong file cấu hình MCP của job, tên server stdio và tên client của dashboard. */
  static readonly SERVER_ID = 'dev-team-dashboard'
  /** Env chọn mode của tiến trình stdio (`readonly` | `full`). */
  static readonly MODE_ENV_VAR = 'DEVTEAM_MCP_MODE'
  /** Cờ argv bật mode `full` — `resolveMode` đọc argv trước env. */
  static readonly MODE_FULL_ARG = '--mode=full'
  /** Token của lượt điều phối — tool `orchestrator_decide` gửi lại cho dashboard. */
  static readonly TOKEN_ENV = 'DASHBOARD_ORCHESTRATOR_TOKEN'
  /** Base URL của dashboard mà tool `orchestrator_decide` gọi về. */
  static readonly BASE_URL_ENV = 'DASHBOARD_ORCHESTRATOR_BASE_URL'
  /** Header mang token của lượt điều phối khi gọi API REST của orchestrator — không phải `Authorization`. */
  static readonly TOKEN_HEADER = 'X-Dashboard-Orchestrator-Token'
  /** Route nhận quyết định điều phối — `orchestrator/api.ts` khai, tool `orchestrator_decide` gọi. */
  static readonly DECIDE_PATH = '/api/orchestrator/decide'

  /** Base URL của chính tiến trình dashboard (`DEV_TEAM_SELF_BASE_URL`) — trả nguyên văn, không trim. */
  static selfBaseUrl(): string | undefined {
    return process.env.DEV_TEAM_SELF_BASE_URL
  }

  private constructor(config: McpStdioServer) {
    super(config)
  }

  protected rebuild(config: McpStdioServer): SelfMcpServer {
    return new SelfMcpServer(config)
  }

  private static entrypoint(): string | null {
    const path = resolvePath(dirnameFromImportMeta(import.meta.url), '../../../../mcp/stdio.ts')
    return existsSync(path) ? path : null
  }

  /** Có gắn được MCP của chính dashboard vào job không — không ném. */
  static canAttach(): boolean {
    try {
      return SelfMcpServer.entrypoint() != null
    } catch {
      return false
    }
  }

  // xem docs/architecture/code/mcp.md §8
  private static orchestratorEnv(metadata: JobMetadata): Record<string, string> | null {
    const baseUrl = SelfMcpServer.selfBaseUrl()
    if (metadata?.orchestratorJob !== true || typeof metadata.orchestratorToken !== 'string' || !baseUrl) {
      return null
    }
    return {
      [SelfMcpServer.TOKEN_ENV]: metadata.orchestratorToken,
      [SelfMcpServer.BASE_URL_ENV]: baseUrl,
    }
  }

  /** Env bơm vào tiến trình CLI của job điều phối — `{}` khi job không đủ guard. */
  static childEnv(metadata?: Record<string, unknown>): Record<string, string> {
    return SelfMcpServer.orchestratorEnv(metadata) ?? {}
  }

  /** Entry stdio cho job điều phối đi tuyến `mcp` — `null` khi không đủ điều kiện gắn. */
  static forJob(metadata?: Record<string, unknown>): SelfMcpServer | null {
    if (metadata?.orchestratorMcpRoute !== 'mcp') return null
    const orchestratorEnv = SelfMcpServer.orchestratorEnv(metadata)
    if (!orchestratorEnv) return null
    const entry = SelfMcpServer.entrypoint()
    if (!entry) return null
    return new SelfMcpServer({
      id: SelfMcpServer.SERVER_ID,
      label: `${SelfMcpServer.SERVER_ID} (self)`,
      enabled: true,
      lastCheck: null,
      transport: 'stdio',
      // xem docs/architecture/code/mcp.md §8
      command: process.execPath,
      args: [entry, SelfMcpServer.MODE_FULL_ARG],
      env: {
        [SelfMcpServer.MODE_ENV_VAR]: 'full',
        ...orchestratorEnv,
      },
    })
  }
}
