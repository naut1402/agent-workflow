import { basename, joinPath, readFile, readTextFile, safeReadDir } from '../../../../backend/lib/fileHelper.js'
import { parseFrontmatter } from '../../../../backend/lib/yamlLib.js'

/**
 * Đọc file markdown agent / skill thành item catalog — phần mọi `CatalogSource`
 * dùng chung, không biết vị trí nguồn nào (§2.3: một hiện thực, gom theo nghiệp vụ).
 */

export interface ScanOpts {
  includeContractSkills?: boolean
}

/** Markdown extensions accepted for a file matched by a custom scan pattern. */
export const PATTERN_MD_EXT = /\.(md|mdc|markdown)$/i

/** Item name derived from a file name: drop the extension, then a `.agent` / `.skill` suffix. */
export function deriveItemName(file: string): string {
  return basename(file)
    .replace(PATTERN_MD_EXT, '')
    .replace(/\.(agent|agents|skill|skills)$/i, '')
    .trim()
}

/** Folder of skill subfolders, each holding a `SKILL.md` named by its frontmatter. */
export async function scanSkillsFlatDir(
  skillsRoot: string,
  source: string,
  pluginLabel: string,
  opts: ScanOpts = {},
): Promise<any[]> {
  const { includeContractSkills = true } = opts
  const skills: any[] = []
  for (const entry of await safeReadDir(skillsRoot)) {
    if (!entry.isDirectory()) continue
    const skillMd = joinPath(skillsRoot, entry.name, 'SKILL.md')
    try {
      const raw = await readTextFile(skillMd)
      const fm = parseFrontmatter(raw)
      if (!fm.name) continue
      const userInvocable = fm['user-invocable'] !== false
      if (!includeContractSkills && !userInvocable) continue
      skills.push({
        id: `${source}:${fm.name}`,
        name: fm.name,
        plugin: pluginLabel,
        source,
        description: (fm.description || '').slice(0, 140),
        user_invocable: userInvocable,
      })
    } catch {
      /* skip */
    }
  }
  return skills
}

/**
 * Read one agent markdown file. `opts.name` pins the name (convention scan keeps
 * using the file name so its output never shifts); `preferFrontmatterName` is only
 * for the custom-pattern branch, where the file name may be arbitrary.
 */
export async function readAgentFile(
  file: string,
  source: string,
  pluginLabel: string,
  opts: { name?: string; preferFrontmatterName?: boolean } = {},
): Promise<any | null> {
  try {
    const raw = await readFile(file, 'utf8')
    const fm = parseFrontmatter(raw)
    const fmName = typeof fm.name === 'string' ? fm.name.trim() : ''
    const name = opts.preferFrontmatterName && fmName ? fmName : opts.name ?? deriveItemName(file)
    if (!name) return null
    return {
      id: `${source}:${name}`,
      name,
      plugin: pluginLabel,
      source,
      description: (fm.description || '').slice(0, 140),
      skills: Array.isArray(fm.skills) ? fm.skills : [],
    }
  } catch {
    return null
  }
}

/** Flat folder of `<name>.md` agent files; the name comes from the file name. */
export async function scanAgentsInDir(
  agentsRoot: string,
  source: string,
  pluginLabel: string,
): Promise<any[]> {
  const agents: any[] = []
  for (const entry of await safeReadDir(agentsRoot)) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const item = await readAgentFile(joinPath(agentsRoot, entry.name), source, pluginLabel, {
      name: entry.name.replace(/\.md$/, ''),
    })
    if (item) agents.push(item)
  }
  return agents
}
