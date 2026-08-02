import fs from 'node:fs/promises'
import path from 'node:path'
import { parseAgentMarkdown } from '../../../core/contracts/agentMarkdown.js'
import { safeReadDir } from '../../../core/lib/fileHelper.js'
import { sanitiseAgentName } from '../../../core/contracts/sanitize.js'
import { customAgentsDir } from './paths.js'

/** Catalog-shaped listing of dashboard-created custom agents (for buildCatalog). */
export async function scanCustomAgents(root: string): Promise<any[]> {
  const dir = customAgentsDir(root)
  const agents: any[] = []
  for (const entry of await safeReadDir(dir)) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const agentName = entry.name.replace(/\.md$/, '')
    try {
      const raw = await fs.readFile(path.join(dir, entry.name), 'utf8')
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
      const raw = await fs.readFile(path.join(dir, entry.name), 'utf8')
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
  const fp = path.join(customAgentsDir(root), `${clean}.md`)
  try {
    const content = await fs.readFile(fp, 'utf8')
    const draft = parseAgentMarkdown(content)
    return { name: clean, content, draft }
  } catch {
    return null
  }
}
