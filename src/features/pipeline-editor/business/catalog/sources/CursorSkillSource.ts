import { homeDir, joinPath } from '../../../../../backend/lib/fileHelper.js'
import { scanSkillsFlatDir } from '../catalogMarkdown.js'
import type { CatalogContext, CatalogSource, ScanResult } from '../CatalogSource.js'

/** Nguồn `cursor`: chỉ có skill, ở `~/.cursor/skills-cursor`. */
export class CursorSkillSource implements CatalogSource {
  readonly priority = 10

  owns(source: string): boolean {
    return source === 'cursor'
  }

  async scan(): Promise<ScanResult> {
    return { skills: await scanSkillsFlatDir(skillsDir(), 'cursor', 'cursor'), agents: [] }
  }

  async resolveSkillPath(_ctx: CatalogContext, _source: string, name: string): Promise<string | null> {
    return joinPath(skillsDir(), name, 'SKILL.md')
  }
}

function skillsDir(): string {
  return joinPath(homeDir(), '.cursor', 'skills-cursor')
}
