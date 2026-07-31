import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import type { Hono } from 'hono'
import type { HonoEnv } from '../types.js'
import { j, unknownProject } from '../respond.js'
import { draftFromAgentMarkdown } from '../../../core/contracts/agentMarkdown.js'
import { parseFrontmatter } from '../../../core/contracts/frontmatter.js'
import { buildCatalog, parseCatalogAgentId, resolveCatalogAgentPath } from '../../catalog/index.js'
import { scanCustomAgents, customAgentsDir } from '../../agents/index.js'
import { buildRules } from '../../rules/index.js'

// Catalog (skills + agents from installed plugins), single agent markdown, rules.
export function registerCatalogRoutes(app: Hono<HonoEnv>): void {
  app.get('/api/catalog', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    return j(c, 200, await buildCatalog(root, { scanCustomAgents }))
  })

  app.get('/api/catalog-agent', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const id = c.req.query('id')
    if (!id) return j(c, 400, { error: 'missing id' })
    const projectRoot = path.dirname(root)
    let agentPath = await resolveCatalogAgentPath(projectRoot, root, id, { customAgentsDir })
    if (!agentPath) {
      const parsed = parseCatalogAgentId(id)
      if (parsed?.source?.startsWith('repo:')) {
        const pluginName = parsed.source.slice('repo:'.length)
        const builtin = path.join(projectRoot, 'plugins', pluginName, 'agents', `${parsed.name}.md`)
        try {
          await fs.access(builtin)
          agentPath = builtin
        } catch {
          /* not found */
        }
      }
    }
    if (!agentPath) return j(c, 404, { error: 'agent file not found' })
    try {
      const raw = await fs.readFile(agentPath, 'utf8')
      const meta = parseCatalogAgentId(id)
      const draft = draftFromAgentMarkdown(raw, yaml, { name: meta?.name, description: '' })
      const fm = parseFrontmatter(raw)
      if (fm.description) draft.description = fm.description
      if (Array.isArray(fm.skills) && fm.skills.length) draft.skills = [...fm.skills]
      return j(c, 200, { id, path: agentPath, content: raw, draft })
    } catch (e: any) {
      return j(c, 500, { error: String(e.message || e) })
    }
  })

  app.get('/api/rules', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    return j(c, 200, await buildRules(root))
  })
}
