import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import yaml from 'js-yaml'
import {
  parseAgentMarkdown,
  ensureSectionOrder,
  getSectionTitle,
} from '../../src/lib/agentMarkdown.js'

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir()
}

export function normalizeAgentRef(ref) {
  if (typeof ref !== 'string') return ref
  if (ref.startsWith('dev-agent-teams:')) {
    return `repo:dev-agent-teams:${ref.slice('dev-agent-teams:'.length)}`
  }
  return ref
}

function parseCatalogAgentId(id) {
  if (typeof id !== 'string' || !id.includes(':')) return null
  const i = id.lastIndexOf(':')
  if (i <= 0) return null
  return { source: id.slice(0, i), name: id.slice(i + 1) }
}

async function safeAccess(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function findInPluginCache(pluginName, fileName) {
  const cacheRoot = path.join(homeDir(), '.claude', 'plugins', 'cache')
  let bestPath = null
  let bestMtime = 0
  try {
    const markets = await fs.readdir(cacheRoot, { withFileTypes: true })
    for (const market of markets) {
      if (!market.isDirectory()) continue
      const pluginPath = path.join(cacheRoot, market.name, pluginName)
      let versions
      try {
        versions = await fs.readdir(pluginPath, { withFileTypes: true })
      } catch {
        continue
      }
      for (const v of versions) {
        if (!v.isDirectory()) continue
        const candidate = path.join(pluginPath, v.name, 'agents', fileName)
        if (!(await safeAccess(candidate))) continue
        let mtime = 0
        try {
          mtime = (await fs.stat(candidate)).mtimeMs
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

async function resolveAgentFilePath(projectRoot, devTeamRoot, agentRef) {
  const id = normalizeAgentRef(agentRef)
  const parsed = parseCatalogAgentId(id)
  if (!parsed?.name) return null
  const { source, name } = parsed
  const fileName = `${name}.md`

  if (source === 'dashboard') {
    return path.join(devTeamRoot, 'custom-agents', fileName)
  }
  if (source === 'user') {
    return path.join(homeDir(), '.claude', 'agents', fileName)
  }
  if (source === 'project') {
    return path.join(projectRoot, '.claude', 'agents', fileName)
  }
  if (source.startsWith('repo:') || source.startsWith('plugin:')) {
    const pluginName = source.includes(':') ? source.slice(source.indexOf(':') + 1) : source
    const builtin = path.join(projectRoot, 'plugins', pluginName, 'agents', fileName)
    if (await safeAccess(builtin)) return builtin
    const cached = await findInPluginCache(pluginName, fileName)
    if (cached) return cached
  }
  return null
}

function buildSystemPrompt(draft) {
  const parts = []
  for (const key of ensureSectionOrder(draft)) {
    const content = draft.sections?.[key]
    if (content?.trim()) {
      parts.push(`## ${getSectionTitle(key, draft)}\n\n${content.trim()}`)
    }
  }
  const unclassified = draft.sections?.unclassified?.trim()
  if (unclassified) parts.push(unclassified)
  return parts.join('\n\n')
}

/**
 * Resolve agentRef to provider-agnostic ResolvedAgent.
 * @param {string} agentRef
 * @param {{ projectRoot: string, devTeamRoot: string }} ctx
 */
export async function resolveAgent(agentRef, ctx) {
  const agentPath = await resolveAgentFilePath(ctx.projectRoot, ctx.devTeamRoot, agentRef)
  if (!agentPath) {
    throw new Error(`agent file not found for ref: ${agentRef}`)
  }
  const raw = await fs.readFile(agentPath, 'utf8')
  const draft = parseAgentMarkdown(raw, yaml)
  return {
    ref: agentRef,
    name: draft.name || path.basename(agentPath, '.md'),
    description: draft.description || '',
    systemPrompt: buildSystemPrompt(draft),
    skills: draft.skills || [],
    model: draft.model,
    agentFilePath: agentPath,
  }
}

export { resolveAgentFilePath }
