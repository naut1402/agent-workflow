import { access, basename, joinPath, readDir, readTextFile, stat } from '../../../core/lib/fileHelper.js'
import os from 'node:os'
import {
  parseAgentMarkdown,
  ensureSectionOrder,
  getSectionTitle,
} from '../../agent-editor/business/agentMarkdown.js'
import type { ResolvedAgent } from './types.js'

function homeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir()
}

export function normalizeAgentRef(ref: unknown): unknown {
  if (typeof ref !== 'string') return ref
  if (ref.startsWith('dev-agent-teams:')) {
    return `repo:dev-agent-teams:${ref.slice('dev-agent-teams:'.length)}`
  }
  return ref
}

function parseCatalogAgentId(id: unknown): { source: string; name: string } | null {
  if (typeof id !== 'string' || !id.includes(':')) return null
  const i = id.lastIndexOf(':')
  if (i <= 0) return null
  return { source: id.slice(0, i), name: id.slice(i + 1) }
}

async function safeAccess(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function findInPluginCache(pluginName: string, fileName: string): Promise<string | null> {
  const cacheRoot = joinPath(homeDir(), '.claude', 'plugins', 'cache')
  let bestPath: string | null = null
  let bestMtime = 0
  try {
    const markets = await readDir(cacheRoot, { withFileTypes: true })
    for (const market of markets) {
      if (!market.isDirectory()) continue
      const pluginPath = joinPath(cacheRoot, market.name, pluginName)
      let versions
      try {
        versions = await readDir(pluginPath, { withFileTypes: true })
      } catch {
        continue
      }
      for (const v of versions) {
        if (!v.isDirectory()) continue
        const candidate = joinPath(pluginPath, v.name, 'agents', fileName)
        if (!(await safeAccess(candidate))) continue
        let mtime = 0
        try {
          mtime = (await stat(candidate)).mtimeMs
        } catch {
          mtime = 0
        }
        if (!bestPath || mtime >= bestMtime) {
          bestPath = candidate
          bestMtime = mtime
        }
      }
    }
  } catch {
    /* ignore */
  }
  return bestPath
}

async function resolveAgentFilePath(
  projectRoot: string,
  devTeamRoot: string,
  agentRef: string,
): Promise<string | null> {
  const id = normalizeAgentRef(agentRef)
  const parsed = parseCatalogAgentId(id)
  if (!parsed?.name) return null
  const { source, name } = parsed
  const fileName = `${name}.md`

  if (source === 'dashboard') {
    return joinPath(devTeamRoot, 'custom-agents', fileName)
  }
  if (source === 'user') {
    return joinPath(homeDir(), '.claude', 'agents', fileName)
  }
  if (source === 'project') {
    return joinPath(projectRoot, '.claude', 'agents', fileName)
  }
  if (source.startsWith('repo:') || source.startsWith('plugin:')) {
    const pluginName = source.includes(':') ? source.slice(source.indexOf(':') + 1) : source
    const builtin = joinPath(projectRoot, 'plugins', pluginName, 'agents', fileName)
    if (await safeAccess(builtin)) return builtin
    const cached = await findInPluginCache(pluginName, fileName)
    if (cached) return cached
  }
  return null
}

function buildSystemPrompt(draft: any): string {
  // `ensureSectionOrder` (agent-editor/business/agentMarkdown) already appends 'unclassified'
  // to the order whenever it has content — it's how the Agent Editor form shows
  // a trailing "Chưa phân loại" box for headings it couldn't classify. Rendering
  // it again here after the loop used to duplicate the whole catch-all block
  // (agentRef `dev-agent-teams:doc-reviewer` reliably triggers this: the
  // agent's intro paragraph + its "Đầu vào" heading aren't canonical sections,
  // so they land in `unclassified` and were sent to the runner twice).
  const parts: string[] = []
  for (const key of ensureSectionOrder(draft)) {
    const content = draft.sections?.[key]
    if (content?.trim()) {
      parts.push(`## ${getSectionTitle(key, draft)}\n\n${content.trim()}`)
    }
  }
  return parts.join('\n\n')
}

/** Resolve agentRef to a provider-agnostic ResolvedAgent. A blank ref is a
 * deliberate "no agent" job (e.g. a quick action whose prompt_template is
 * already a complete, free-form instruction) — it runs with no system prompt
 * merged in, just the job's own userPrompt (see buildPrompt in
 * providers/claude-code-cli.ts). */
export async function resolveAgent(
  agentRef: string,
  ctx: { projectRoot: string; devTeamRoot: string },
): Promise<ResolvedAgent> {
  if (!agentRef?.trim()) {
    return { ref: '', name: 'ad-hoc', description: '', systemPrompt: '', skills: [] }
  }
  const agentPath = await resolveAgentFilePath(ctx.projectRoot, ctx.devTeamRoot, agentRef)
  if (!agentPath) {
    throw new Error(`agent file not found for ref: ${agentRef}`)
  }
  const raw = await readTextFile(agentPath)
  const draft: any = parseAgentMarkdown(raw)
  return {
    ref: agentRef,
    name: draft.name || basename(agentPath, '.md'),
    description: draft.description || '',
    systemPrompt: buildSystemPrompt(draft),
    skills: draft.skills || [],
    model: draft.model,
    agentFilePath: agentPath,
  }
}

export { resolveAgentFilePath }
