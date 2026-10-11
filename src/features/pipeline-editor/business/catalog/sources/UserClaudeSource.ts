import { homeDir, joinPath } from '../../../../../backend/lib/fileHelper.js'
import { scanAgentsInDir, scanSkillsFlatDir } from '../catalogMarkdown.js'
import type { CatalogContext, ScanResult } from '../CatalogSource.js'
import { AbstractHomeSkillSource } from './AbstractHomeSkillSource.js'

/** Nguồn `user`: skill ở `~/.claude/skills`, agent ở thư mục agent cấp máy (qua port). */
export class UserClaudeSource extends AbstractHomeSkillSource {
  readonly priority = 20
  protected readonly skillsHomeSegments = ['.claude', 'skills']

  owns(source: string): boolean {
    return source === 'user'
  }

  async scan(ctx: CatalogContext): Promise<ScanResult> {
    return {
      skills: await scanSkillsFlatDir(this.skillsDir(), 'user', 'user'),
      agents: await scanAgentsInDir(agentsDir(ctx), 'user', 'user'),
    }
  }

  async resolveAgentPath(ctx: CatalogContext, _source: string, name: string): Promise<string | null> {
    return joinPath(agentsDir(ctx), `${name}.md`)
  }
}

/** Lời gọi không cấp port (nl-chat, test) rơi về đúng vị trí `globalAgentsDir` của agent-editor. */
function agentsDir(ctx: CatalogContext): string {
  return ctx.agentStore.userAgentsDir?.() ?? joinPath(homeDir(), '.claude', 'agents')
}
