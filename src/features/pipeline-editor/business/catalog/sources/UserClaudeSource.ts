import { homeDir, joinPath } from '../../../../../backend/lib/fileHelper.js'
import { scanAgentsInDir, scanSkillsFlatDir } from '../catalogMarkdown.js'
import type { CatalogContext, CatalogSource, ScanResult } from '../CatalogSource.js'

/** Nguồn `user`: skill ở `~/.claude/skills`, agent ở thư mục agent cấp máy (qua port). */
export class UserClaudeSource implements CatalogSource {
  readonly priority = 20

  owns(source: string): boolean {
    return source === 'user'
  }

  async scan(ctx: CatalogContext): Promise<ScanResult> {
    return {
      skills: await scanSkillsFlatDir(skillsDir(), 'user', 'user'),
      agents: await scanAgentsInDir(agentsDir(ctx), 'user', 'user'),
    }
  }

  async resolveAgentPath(ctx: CatalogContext, _source: string, name: string): Promise<string | null> {
    return joinPath(agentsDir(ctx), `${name}.md`)
  }

  async resolveSkillPath(_ctx: CatalogContext, _source: string, name: string): Promise<string | null> {
    return joinPath(skillsDir(), name, 'SKILL.md')
  }
}

function skillsDir(): string {
  return joinPath(homeDir(), '.claude', 'skills')
}

/** Lời gọi không cấp port (nl-chat, test) rơi về đúng vị trí `globalAgentsDir` của agent-editor. */
function agentsDir(ctx: CatalogContext): string {
  return ctx.agentStore.userAgentsDir?.() ?? joinPath(homeDir(), '.claude', 'agents')
}
