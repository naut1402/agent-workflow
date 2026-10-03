import { APP_VERSION } from '../src/backend/configs/appVersion.js'
import { initLogDriverFromPrefs, installEventLogSubscriber } from '../src/backend/log/index.js'
import { AbstractMcpServer } from './AbstractMcpServer.js'
import type { AbstractMcpTools } from './AbstractMcpTools.js'
import { KnowledgeTools } from './tools/KnowledgeTools.js'
import { ProjectTools } from './tools/ProjectTools.js'
import { TaskTools } from './tools/TaskTools.js'

export class DashboardMcpServer extends AbstractMcpServer {
  protected readonly name = 'dev-team-dashboard'
  protected readonly version = APP_VERSION

  protected toolGroups(): AbstractMcpTools[] {
    return [new TaskTools(), new KnowledgeTools(), new ProjectTools()]
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
        + 'Đặt DEVTEAM_MCP_MODE=full nếu chạy pipeline agent.',
    ]
  }

  // xem docs/mcp/server.md §8.4
  protected onStart(): void {
    initLogDriverFromPrefs()
    installEventLogSubscriber()
  }
}
