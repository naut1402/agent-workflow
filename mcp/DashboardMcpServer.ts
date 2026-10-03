import { APP_VERSION } from '../src/backend/configs/appVersion.js'
import { initLogDriverFromPrefs, installEventLogSubscriber } from '../src/backend/log/index.js'
import { resolveProjectRoot } from '../src/backend/registry.js'
import { AbstractMcpServer, type McpMode, type ModeSource } from './AbstractMcpServer.js'
import type { AbstractMcpTools, RootResolver } from './AbstractMcpTools.js'
import { KnowledgeTools } from './tools/KnowledgeTools.js'
import { ProjectTools } from './tools/ProjectTools.js'
import { TaskTools } from './tools/TaskTools.js'

export class DashboardMcpServer extends AbstractMcpServer {
  static readonly SERVER_NAME = 'dev-team-dashboard'
  static readonly MODE_ENV_VAR = 'DEVTEAM_MCP_MODE'

  static resolveMode(opts: ModeSource = {}): McpMode {
    return super.resolveMode({
      ...opts,
      envVar: DashboardMcpServer.MODE_ENV_VAR,
      label: DashboardMcpServer.SERVER_NAME,
    })
  }

  static readonly resolveRoot: RootResolver = (project) => {
    const root = resolveProjectRoot(project ?? null)
    if (root) return { root }
    return {
      error: project
        ? `unknown project: ${project}`
        : 'no default project — call list_projects, or set DEV_TEAM_ROOT / DEV_TEAM_DASHBOARD_HOME for this process',
    }
  }

  protected readonly name = DashboardMcpServer.SERVER_NAME
  protected readonly version = APP_VERSION

  protected toolGroups(): AbstractMcpTools[] {
    const resolveRoot = DashboardMcpServer.resolveRoot
    return [new TaskTools(resolveRoot), new KnowledgeTools(resolveRoot), new ProjectTools(resolveRoot)]
  }

  protected instructionsPreamble(): string[] {
    return [
      'Server state của dev-team-dashboard: task, artifact, knowledge của pipeline agent.',
      'Có tool tương đương thì gọi nó thay vì Bash: tool nhận `taskId` (và `project` tuỳ chọn) '
        + 'nên không phải `cd`, và kết quả là JSON có cấu trúc thay vì text phải tự parse.',
    ]
  }

  protected startupWarnings(): string[] {
    if (this.hasTool('create_qa')) return []
    return [
      `mode=${this.mode}: create_qa KHÔNG được đăng ký, `
        + 'nhưng docs/template/agents/* hướng dẫn agent gọi nó. '
        + `Đặt ${DashboardMcpServer.MODE_ENV_VAR}=full nếu chạy pipeline agent.`,
    ]
  }

  // xem docs/mcp/server.md §8.4
  protected onStart(): void {
    initLogDriverFromPrefs()
    installEventLogSubscriber()
  }
}
