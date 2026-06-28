import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import type { Hono } from 'hono'
import type { HonoEnv } from '../types.js'
import { j, parseBody, unknownProject } from '../respond.js'
import { parseAgentMarkdown, compileAgentMarkdown } from '../../../shared/agentMarkdown.js'
import { safeReadDir } from '../../../shared/fs.js'
import { sanitiseProfileName, sanitiseAgentName } from '../../../shared/sanitize.js'
import {
  customAgentsDir,
  agentTemplatesDir,
  workflowStepTemplatesDir,
  listCustomAgentMeta,
  readCustomAgent,
  fetchUrlSafe,
  generateDraftFromNl,
  ensureDefaultTemplate,
} from '../../agents/index.js'

// Custom agents (dashboard-created), agent templates, workflow-step templates.
export function registerAgentRoutes(app: Hono<HonoEnv>): void {
  // ── Custom agents ──────────────────────────────────────────────────────────
  app.get('/api/custom-agents', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const name = c.req.query('name')
    if (name) {
      const agent = await readCustomAgent(root, name)
      if (!agent) return j(c, 404, { error: 'not found' })
      return j(c, 200, agent)
    }
    return j(c, 200, { agents: await listCustomAgentMeta(root) })
  })
  app.post('/api/custom-agents', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON' })
    const draft = b.value.draft || b.value
    const clean = sanitiseAgentName(draft.name)
    if (!clean) return j(c, 400, { error: 'invalid agent name' })
    await fs.mkdir(customAgentsDir(root), { recursive: true })
    const content = compileAgentMarkdown({ ...draft, name: clean }, yaml)
    await fs.writeFile(path.join(customAgentsDir(root), `${clean}.md`), content, 'utf8')
    return j(c, 200, { saved: true, name: clean })
  })
  app.delete('/api/custom-agents', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const name = sanitiseAgentName(c.req.query('name') || '')
    if (!name) return j(c, 400, { error: 'invalid name' })
    try {
      await fs.unlink(path.join(customAgentsDir(root), `${name}.md`))
      return j(c, 200, { deleted: true, name })
    } catch {
      return j(c, 404, { error: 'not found' })
    }
  })

  app.post('/api/custom-agents/export', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON' })
    const name = sanitiseAgentName(b.value.name)
    if (!name) return j(c, 400, { error: 'invalid name' })
    const agent = await readCustomAgent(root, name)
    if (!agent) return j(c, 404, { error: 'agent not found' })
    const exportDir = path.join(path.dirname(root), '.claude', 'agents')
    await fs.mkdir(exportDir, { recursive: true })
    const dest = path.join(exportDir, `${name}.md`)
    if (!b.value.overwrite) {
      try {
        await fs.access(dest)
        return j(c, 409, { error: 'file exists', path: `.claude/agents/${name}.md` })
      } catch {
        /* ok */
      }
    }
    await fs.writeFile(dest, agent.content, 'utf8')
    return j(c, 200, { exported: true, path: `.claude/agents/${name}.md` })
  })

  app.post('/api/custom-agents/generate', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON' })
    const draft = await generateDraftFromNl(b.value.description || '')
    return j(c, 200, { draft })
  })

  // ── Agent templates ──────────────────────────────────────────────────────
  app.get('/api/agent-templates', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    await ensureDefaultTemplate(root)
    const tplDir = agentTemplatesDir(root)
    const name = c.req.query('name')
    if (name) {
      const clean = sanitiseAgentName(name) || sanitiseProfileName(name)
      if (!clean) return j(c, 400, { error: 'invalid name' })
      try {
        const raw = await fs.readFile(path.join(tplDir, `${clean}.md`), 'utf8')
        return j(c, 200, { name: clean, content: raw, draft: parseAgentMarkdown(raw, yaml) })
      } catch {
        return j(c, 404, { error: 'not found' })
      }
    }
    const templates: Array<{ name: string; description: string }> = []
    for (const entry of await safeReadDir(tplDir)) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const n = entry.name.replace(/\.md$/, '')
      try {
        const raw = await fs.readFile(path.join(tplDir, entry.name), 'utf8')
        const d = parseAgentMarkdown(raw, yaml)
        templates.push({ name: n, description: d.description || '' })
      } catch {
        templates.push({ name: n, description: '' })
      }
    }
    return j(c, 200, { templates: templates.sort((a, b) => a.name.localeCompare(b.name)) })
  })
  app.post('/api/agent-templates', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    await ensureDefaultTemplate(root)
    const tplDir = agentTemplatesDir(root)
    const ctype = c.req.header('content-type') || ''
    if (ctype.includes('multipart/form-data')) {
      const body = await c.req.text()
      const boundary = ctype.split('boundary=')[1]
      if (!boundary) return j(c, 400, { error: 'missing boundary' })
      const parts = body.split(`--${boundary}`)
      let fileContent = ''
      let fileName = 'uploaded-template'
      for (const part of parts) {
        if (part.includes('filename=')) {
          const fnMatch = /filename="([^"]+)"/.exec(part)
          if (fnMatch) fileName = fnMatch[1].replace(/\.md$/i, '')
          const idx = part.indexOf('\r\n\r\n')
          if (idx >= 0) fileContent = part.slice(idx + 4).replace(/\r\n--$/, '').trim()
        }
      }
      if (!fileContent) return j(c, 400, { error: 'no file content' })
      const clean = sanitiseAgentName(fileName) || 'uploaded-template'
      await fs.mkdir(tplDir, { recursive: true })
      await fs.writeFile(path.join(tplDir, `${clean}.md`), fileContent, 'utf8')
      return j(c, 200, { saved: true, name: clean })
    }
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON' })
    const parsed = b.value
    if (parsed.url) {
      let text: string
      try {
        text = await fetchUrlSafe(parsed.url)
      } catch (e: any) {
        return j(c, 400, { error: String(e.message || e) })
      }
      const draft = parseAgentMarkdown(text, yaml)
      const clean = sanitiseAgentName(parsed.name || draft.name || 'url-template') || 'url-template'
      await fs.mkdir(tplDir, { recursive: true })
      await fs.writeFile(path.join(tplDir, `${clean}.md`), text, 'utf8')
      return j(c, 200, { saved: true, name: clean, draft })
    }
    const draft = parsed.draft || parsed
    const clean = sanitiseAgentName(draft.name || parsed.name)
    if (!clean) return j(c, 400, { error: 'invalid template name' })
    await fs.mkdir(tplDir, { recursive: true })
    await fs.writeFile(path.join(tplDir, `${clean}.md`), compileAgentMarkdown(draft, yaml), 'utf8')
    return j(c, 200, { saved: true, name: clean })
  })
  app.delete('/api/agent-templates', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const tplDir = agentTemplatesDir(root)
    const name =
      sanitiseAgentName(c.req.query('name') || '') || sanitiseProfileName(c.req.query('name') || '')
    if (!name) return j(c, 400, { error: 'invalid name' })
    try {
      await fs.unlink(path.join(tplDir, `${name}.md`))
      return j(c, 200, { deleted: true, name })
    } catch {
      return j(c, 404, { error: 'not found' })
    }
  })

  // ── Workflow step templates (builder) ──────────────────────────────────────
  app.get('/api/workflow-step-templates', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const tplDir = workflowStepTemplatesDir(root)
    const name = c.req.query('name')
    if (name) {
      const clean = sanitiseAgentName(name)
      if (!clean) return j(c, 400, { error: 'invalid name' })
      try {
        const raw = await fs.readFile(path.join(tplDir, `${clean}.json`), 'utf8')
        return j(c, 200, { name: clean, template: JSON.parse(raw) })
      } catch {
        return j(c, 404, { error: 'not found' })
      }
    }
    await fs.mkdir(tplDir, { recursive: true })
    const templates: Array<{ name: string; title: string }> = []
    for (const entry of await safeReadDir(tplDir)) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const n = entry.name.replace(/\.json$/, '')
      try {
        const t = JSON.parse(await fs.readFile(path.join(tplDir, entry.name), 'utf8'))
        templates.push({ name: n, title: t.title || n })
      } catch {
        templates.push({ name: n, title: n })
      }
    }
    return j(c, 200, { templates: templates.sort((a, b) => a.name.localeCompare(b.name)) })
  })
  app.post('/api/workflow-step-templates', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const tplDir = workflowStepTemplatesDir(root)
    const b = await parseBody(c)
    if (!b.ok) return j(c, 400, { error: 'invalid JSON' })
    const template = b.value.template || b.value
    const clean = sanitiseAgentName(template.name || b.value.name)
    if (!clean) return j(c, 400, { error: 'invalid template name' })
    const payload = {
      name: clean,
      title: template.title || clean,
      body: template.body || '',
      pipeline_step_id: template.pipeline_step_id || '',
    }
    await fs.mkdir(tplDir, { recursive: true })
    await fs.writeFile(path.join(tplDir, `${clean}.json`), JSON.stringify(payload, null, 2), 'utf8')
    return j(c, 200, { saved: true, name: clean })
  })
  app.delete('/api/workflow-step-templates', async (c) => {
    const root = c.get('root')
    if (!root) return unknownProject(c)
    const tplDir = workflowStepTemplatesDir(root)
    const name = sanitiseAgentName(c.req.query('name') || '')
    if (!name) return j(c, 400, { error: 'invalid name' })
    try {
      await fs.unlink(path.join(tplDir, `${name}.json`))
      return j(c, 200, { deleted: true, name })
    } catch {
      return j(c, 404, { error: 'not found' })
    }
  })
}
