import { basename, dirname, joinPath, readTextFile, safeReadDir, statSafe } from '../../../../../backend/lib/fileHelper.js'
import { parseFrontmatter } from '../../../../../backend/lib/yamlLib.js'
import { expandScanPatterns } from '../../scanPatterns.js'
import {
  PATTERN_MD_EXT,
  deriveItemName,
  readAgentFile,
  scanAgentsInDir,
  scanSkillsFlatDir,
  type ScanOpts,
} from '../catalogMarkdown.js'
import type { CatalogContext, CatalogSource, ScanResult } from '../CatalogSource.js'

const SKILL_ENTRY_FILE = /^skill\.(md|mdc|markdown)$/i

/**
 * Nguồn `project` qua `settings.scanPatterns` — cho repo không theo convention.
 * Cùng id `project:<name>` với `ProjectClaudeSource`, nên ở chỗ lắp ráp nó phải
 * đứng SAU nguồn convention: khi trùng priority, `dedupeCatalogItems` giữ item
 * gặp trước, và chuỗi resolve thử convention trước.
 */
export class PatternSource implements CatalogSource {
  readonly priority = 50

  owns(source: string): boolean {
    return source === 'project'
  }

  async scan(ctx: CatalogContext): Promise<ScanResult> {
    const patterns = ctx.scanPatterns
    if (!patterns?.agents?.length && !patterns?.skills?.length) return { skills: [], agents: [] }
    return {
      skills: await scanSkillsByPatterns(ctx.projectRoot, patterns.skills),
      agents: await scanAgentsByPatterns(ctx.projectRoot, patterns.agents),
    }
  }

  async resolveAgentPath(ctx: CatalogContext, _source: string, name: string): Promise<string | null> {
    return resolveAgentPathByPatterns(ctx.projectRoot, name, ctx.scanPatterns?.agents)
  }

  async resolveSkillPath(ctx: CatalogContext, _source: string, name: string): Promise<string | null> {
    return resolveSkillPathByPatterns(ctx.projectRoot, name, ctx.scanPatterns?.skills)
  }
}

/**
 * Agents from custom scan patterns. A matched directory goes through the normal
 * directory scanner; a matched file is loaded on its own.
 */
export async function scanAgentsByPatterns(
  projectRoot: string,
  patterns: string[] | null | undefined,
): Promise<any[]> {
  const agents: any[] = []
  for (const match of await expandScanPatterns(projectRoot, patterns)) {
    if (match.isDirectory) {
      agents.push(...(await scanAgentsInDir(match.path, 'project', 'project')))
      continue
    }
    if (!PATTERN_MD_EXT.test(match.path)) continue
    const item = await readAgentFile(match.path, 'project', 'project', { preferFrontmatterName: true })
    if (item) agents.push(item)
  }
  return agents
}

/** Load ONE skill markdown file matched by a pattern. Returns null when unusable. */
async function readSkillFile(file: string, includeContractSkills: boolean): Promise<any | null> {
  try {
    const fm = parseFrontmatter(await readTextFile(file))
    const fmName = typeof fm.name === 'string' ? fm.name.trim() : ''
    // No frontmatter name: a SKILL.md is named after its folder, anything else after the file.
    const name = fmName
      || (SKILL_ENTRY_FILE.test(basename(file)) ? basename(dirname(file)) : deriveItemName(file))
    if (!name) return null
    const userInvocable = fm['user-invocable'] !== false
    if (!includeContractSkills && !userInvocable) return null
    return {
      id: `project:${name}`,
      name,
      plugin: 'project',
      source: 'project',
      description: (fm.description || '').slice(0, 140),
      user_invocable: userInvocable,
    }
  } catch {
    return null
  }
}

/** Skills from custom scan patterns — same dir/file split as scanAgentsByPatterns. */
export async function scanSkillsByPatterns(
  projectRoot: string,
  patterns: string[] | null | undefined,
  opts: ScanOpts = {},
): Promise<any[]> {
  const { includeContractSkills = true } = opts
  const skills: any[] = []
  for (const match of await expandScanPatterns(projectRoot, patterns)) {
    if (match.isDirectory) {
      skills.push(...(await scanSkillsFlatDir(match.path, 'project', 'project', opts)))
      continue
    }
    if (!PATTERN_MD_EXT.test(match.path)) continue
    const item = await readSkillFile(match.path, includeContractSkills)
    if (item) skills.push(item)
  }
  return skills
}

/**
 * Resolve one agent's on-disk path by name via `scanPatterns.agents` — the
 * wildcard-scan counterpart of the fixed `.claude/agents/<name>.md` path.
 * Mirrors `scanAgentsByPatterns` match-by-match so a name it lists there
 * always maps back to the exact file that produced it.
 */
export async function resolveAgentPathByPatterns(
  projectRoot: string,
  name: string,
  patterns: string[] | null | undefined,
): Promise<string | null> {
  for (const match of await expandScanPatterns(projectRoot, patterns)) {
    if (match.isDirectory) {
      const candidate = joinPath(match.path, `${name}.md`)
      if ((await statSafe(candidate)).exists) return candidate
      continue
    }
    if (!PATTERN_MD_EXT.test(match.path)) continue
    const item = await readAgentFile(match.path, 'project', 'project', { preferFrontmatterName: true })
    if (item?.name === name) return match.path
  }
  return null
}

/**
 * Resolve one skill's on-disk path by name via `scanPatterns.skills`. Mirrors
 * `scanSkillsByPatterns`: a directory match is a folder of skill subfolders
 * (name comes from each `SKILL.md`'s frontmatter, not the folder name), a
 * file match is one markdown matched directly.
 */
export async function resolveSkillPathByPatterns(
  projectRoot: string,
  name: string,
  patterns: string[] | null | undefined,
  opts: ScanOpts = {},
): Promise<string | null> {
  const { includeContractSkills = true } = opts
  for (const match of await expandScanPatterns(projectRoot, patterns)) {
    const found = match.isDirectory
      ? await findSkillInFolder(match.path, name, includeContractSkills)
      : await matchSkillFile(match.path, name, includeContractSkills)
    if (found) return found
  }
  return null
}

/** Directory match: folder of skill subfolders, each `SKILL.md` named by its frontmatter. */
async function findSkillInFolder(dir: string, name: string, includeContractSkills: boolean): Promise<string | null> {
  for (const entry of await safeReadDir(dir)) {
    if (!entry.isDirectory()) continue
    const skillMd = joinPath(dir, entry.name, 'SKILL.md')
    const item = await readSkillFile(skillMd, includeContractSkills)
    if (item?.name === name) return skillMd
  }
  return null
}

/** File match: one markdown matched directly — `file` when it is the skill `name`. */
async function matchSkillFile(file: string, name: string, includeContractSkills: boolean): Promise<string | null> {
  if (!PATTERN_MD_EXT.test(file)) return null
  const item = await readSkillFile(file, includeContractSkills)
  return item?.name === name ? file : null
}
