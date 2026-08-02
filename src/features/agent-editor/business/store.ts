import { parseAgentMarkdown } from '../../../core/contracts/agentMarkdown.js'
import { joinPath, readFile, readTextFile, safeReadDir } from '../../../core/lib/fileHelper.js'
import { customAgentsDir } from './paths.js'

/** Sanitize an agent / template name (stricter charset than profile names). */
export function sanitiseAgentName(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) return null
  if (/[\\/\0]/.test(name)) return null
  const clean = name.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
  return clean || null
}

/** Catalog-shaped listing of dashboard-created custom agents (for buildCatalog). */
export async function scanCustomAgents(root: string): Promise<any[]> {
  const dir = customAgentsDir(root)
  const agents: any[] = []
  for (const entry of await safeReadDir(dir)) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const agentName = entry.name.replace(/\.md$/, '')
    try {
      const raw = await readFile(joinPath(dir, entry.name), 'utf8')
      const draft = parseAgentMarkdown(raw)
      agents.push({
        id: `dashboard:${agentName}`,
        name: agentName,
        plugin: 'dashboard',
        source: 'dashboard',
        description: (draft.description || '').slice(0, 140),
        skills: draft.skills || [],
        editable: true,
      })
    } catch {
      /* skip */
    }
  }
  return agents
}

/** Lightweight metadata listing of custom agents for the agent editor list. */
export async function listCustomAgentMeta(root: string): Promise<any[]> {
  const dir = customAgentsDir(root)
  const agents: any[] = []
  for (const entry of await safeReadDir(dir)) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const name = entry.name.replace(/\.md$/, '')
    try {
      const raw = await readFile(joinPath(dir, entry.name), 'utf8')
      const draft: any = parseAgentMarkdown(raw)
      agents.push({
        name,
        description: draft.description || '',
        model: draft.model || '',
        editable: draft.created_by === 'dashboard' || draft.editable !== false,
      })
    } catch {
      agents.push({ name, description: '', model: '', editable: true })
    }
  }
  return agents.sort((a, b) => a.name.localeCompare(b.name))
}

/** Read one custom agent's raw markdown + parsed draft, or null if invalid/missing. */
export async function readCustomAgent(root: string, name: string) {
  const clean = sanitiseAgentName(name)
  if (!clean) return null
  const fp = joinPath(customAgentsDir(root), `${clean}.md`)
  try {
    const content = await readTextFile(fp)
    const draft = parseAgentMarkdown(content)
    return { name: clean, content, draft }
  } catch {
    return null
  }
}
