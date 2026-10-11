import { joinPath, statSafe } from '../../../../../backend/lib/fileHelper.js'
import { scanAgentsInDir, scanSkillsFlatDir } from '../catalogMarkdown.js'
import type { CatalogContext, CatalogSource, ScanResult } from '../CatalogSource.js'

/**
 * Nguồn `project` theo convention: `<project>/.claude/{skills,agents}`.
 * Resolve chỉ nhận khi file có thật — cùng id `project:<name>` còn có thể đến từ
 * `PatternSource`, nên trả null để chuỗi resolve thử nguồn đó.
 */
export class ProjectClaudeSource implements CatalogSource {
  readonly priority = 50

  owns(source: string): boolean {
    return source === 'project'
  }

  async scan(ctx: CatalogContext): Promise<ScanResult> {
    const skills = await scanSkillsFlatDir(joinPath(ctx.projectRoot, '.claude', 'skills'), 'project', 'project')
    const agents = await scanAgentsInDir(joinPath(ctx.projectRoot, '.claude', 'agents'), 'project', 'project')
    return { skills, agents }
  }

  async resolveAgentPath(ctx: CatalogContext, _source: string, name: string): Promise<string | null> {
    return existing(joinPath(ctx.projectRoot, '.claude', 'agents', `${name}.md`))
  }

  async resolveSkillPath(ctx: CatalogContext, _source: string, name: string): Promise<string | null> {
    return existing(joinPath(ctx.projectRoot, '.claude', 'skills', name, 'SKILL.md'))
  }
}

async function existing(file: string): Promise<string | null> {
  return (await statSafe(file)).exists ? file : null
}
