import { scanSkillsFlatDir } from '../catalogMarkdown.js'
import type { ScanResult } from '../CatalogSource.js'
import { AbstractHomeSkillSource } from './AbstractHomeSkillSource.js'

/** Nguồn `cursor`: chỉ có skill, ở `~/.cursor/skills-cursor`. */
export class CursorSkillSource extends AbstractHomeSkillSource {
  readonly priority = 10
  protected readonly skillsHomeSegments = ['.cursor', 'skills-cursor']

  owns(source: string): boolean {
    return source === 'cursor'
  }

  async scan(): Promise<ScanResult> {
    return { skills: await scanSkillsFlatDir(this.skillsDir(), 'cursor', 'cursor'), agents: [] }
  }
}
