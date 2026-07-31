import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { AbstractController } from '../../core/http/AbstractController.js'
import { parseAgentMarkdown, compileAgentMarkdown } from '../../core/contracts/agentMarkdown.js'
import { safeReadDir } from '../../core/contracts/fs.js'
import { sanitiseProfileName, sanitiseAgentName } from '../../core/contracts/sanitize.js'
import { emitAudit } from '../logs/business/store.js'
import {
  customAgentsDir,
  agentTemplatesDir,
  workflowStepTemplatesDir,
  listCustomAgentMeta,
  readCustomAgent,
  fetchUrlSafe,
  generateDraftFromNl,
  ensureDefaultTemplate,
} from './business/index.js'

export class AgentEditorController extends AbstractController {
  async listOrGetCustomAgents() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    const name = this.c.req.query('name')
    if (name) {
      const agent = await readCustomAgent(root, name)
      if (!agent) return this.notFound('not found')
      return this.ok(agent)
    }
    return this.ok({ agents: await listCustomAgentMeta(root) })
  }

  async createCustomAgent() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    const b = await this.requireJsonBody()
    if ('error' in b) return b.error
    const draft = b.value.draft || b.value
    const clean = sanitiseAgentName(draft.name)
    if (!clean) return this.badRequest('invalid agent name')
    await fs.mkdir(customAgentsDir(root), { recursive: true })
    const content = compileAgentMarkdown({ ...draft, name: clean }, yaml)
    await fs.writeFile(path.join(customAgentsDir(root), `${clean}.md`), content, 'utf8')
    emitAudit({ op: 'create', entity: 'custom-agent', identifier: clean, projectId: this.projectId })
    return this.ok({ saved: true, name: clean })
  }

  async deleteCustomAgent() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    const name = sanitiseAgentName(this.c.req.query('name') || '')
    if (!name) return this.badRequest('invalid name')
    try {
      await fs.unlink(path.join(customAgentsDir(root), `${name}.md`))
      emitAudit({ op: 'delete', entity: 'custom-agent', identifier: name, projectId: this.projectId })
      return this.ok({ deleted: true, name })
    } catch {
      return this.notFound('not found')
    }
  }

  async exportCustomAgents() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    const b = await this.requireJsonBody()
    if ('error' in b) return b.error
    const name = sanitiseAgentName(b.value.name)
    if (!name) return this.badRequest('invalid name')
    const agent = await readCustomAgent(root, name)
    if (!agent) return this.notFound('agent not found')
    const exportDir = path.join(path.dirname(root), '.claude', 'agents')
    await fs.mkdir(exportDir, { recursive: true })
    const dest = path.join(exportDir, `${name}.md`)
    if (!b.value.overwrite) {
      try {
        await fs.access(dest)
        return this.json(409, { error: 'file exists', path: `.claude/agents/${name}.md` })
      } catch {
        /* ok */
      }
    }
    await fs.writeFile(dest, agent.content, 'utf8')
    emitAudit({ op: 'export', entity: 'custom-agent', identifier: name, projectId: this.projectId })
    return this.ok({ exported: true, path: `.claude/agents/${name}.md` })
  }

  async generateCustomAgent() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const b = await this.requireJsonBody()
    if ('error' in b) return b.error
    const draft = await generateDraftFromNl(b.value.description || '')
    return this.ok({ draft })
  }

  async listAgentTemplates() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    await ensureDefaultTemplate(root)
    const tplDir = agentTemplatesDir(root)
    const name = this.c.req.query('name')
    if (name) {
      const clean = sanitiseAgentName(name) || sanitiseProfileName(name)
      if (!clean) return this.badRequest('invalid name')
      try {
        const raw = await fs.readFile(path.join(tplDir, `${clean}.md`), 'utf8')
        return this.ok({ name: clean, content: raw, draft: parseAgentMarkdown(raw, yaml) })
      } catch {
        return this.notFound('not found')
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
    return this.ok({ templates: templates.sort((a, b) => a.name.localeCompare(b.name)) })
  }

  async saveAgentTemplate() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    await ensureDefaultTemplate(root)
    const tplDir = agentTemplatesDir(root)
    const ctype = this.c.req.header('content-type') || ''
    if (ctype.includes('multipart/form-data')) {
      const body = await this.c.req.text()
      const boundary = ctype.split('boundary=')[1]
      if (!boundary) return this.badRequest('missing boundary')
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
      if (!fileContent) return this.badRequest('no file content')
      const clean = sanitiseAgentName(fileName) || 'uploaded-template'
      await fs.mkdir(tplDir, { recursive: true })
      await fs.writeFile(path.join(tplDir, `${clean}.md`), fileContent, 'utf8')
      emitAudit({ op: 'create', entity: 'agent-template', identifier: clean, projectId: this.projectId })
      return this.ok({ saved: true, name: clean })
    }
    const b = await this.requireJsonBody()
    if ('error' in b) return b.error
    const parsed = b.value
    if (parsed.url) {
      let text: string
      try {
        text = await fetchUrlSafe(parsed.url)
      } catch (e: any) {
        return this.badRequest(String(e.message || e))
      }
      const draft = parseAgentMarkdown(text, yaml)
      const clean = sanitiseAgentName(parsed.name || draft.name || 'url-template') || 'url-template'
      await fs.mkdir(tplDir, { recursive: true })
      await fs.writeFile(path.join(tplDir, `${clean}.md`), text, 'utf8')
      emitAudit({ op: 'create', entity: 'agent-template', identifier: clean, projectId: this.projectId })
      return this.ok({ saved: true, name: clean, draft })
    }
    const draft = parsed.draft || parsed
    const clean = sanitiseAgentName(draft.name || parsed.name)
    if (!clean) return this.badRequest('invalid template name')
    await fs.mkdir(tplDir, { recursive: true })
    await fs.writeFile(path.join(tplDir, `${clean}.md`), compileAgentMarkdown(draft, yaml), 'utf8')
    emitAudit({ op: 'create', entity: 'agent-template', identifier: clean, projectId: this.projectId })
    return this.ok({ saved: true, name: clean })
  }

  async deleteAgentTemplate() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    const tplDir = agentTemplatesDir(root)
    const name =
      sanitiseAgentName(this.c.req.query('name') || '') ||
      sanitiseProfileName(this.c.req.query('name') || '')
    if (!name) return this.badRequest('invalid name')
    try {
      await fs.unlink(path.join(tplDir, `${name}.md`))
      emitAudit({ op: 'delete', entity: 'agent-template', identifier: name, projectId: this.projectId })
      return this.ok({ deleted: true, name })
    } catch {
      return this.notFound('not found')
    }
  }

  async listWorkflowStepTemplates() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    const tplDir = workflowStepTemplatesDir(root)
    const name = this.c.req.query('name')
    if (name) {
      const clean = sanitiseAgentName(name)
      if (!clean) return this.badRequest('invalid name')
      try {
        const raw = await fs.readFile(path.join(tplDir, `${clean}.json`), 'utf8')
        return this.ok({ name: clean, template: JSON.parse(raw) })
      } catch {
        return this.notFound('not found')
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
    return this.ok({ templates: templates.sort((a, b) => a.name.localeCompare(b.name)) })
  }

  async saveWorkflowStepTemplate() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    const tplDir = workflowStepTemplatesDir(root)
    const b = await this.requireJsonBody()
    if ('error' in b) return b.error
    const template = b.value.template || b.value
    const clean = sanitiseAgentName(template.name || b.value.name)
    if (!clean) return this.badRequest('invalid template name')
    const payload = {
      name: clean,
      title: template.title || clean,
      body: template.body || '',
      pipeline_step_id: template.pipeline_step_id || '',
    }
    await fs.mkdir(tplDir, { recursive: true })
    await fs.writeFile(path.join(tplDir, `${clean}.json`), JSON.stringify(payload, null, 2), 'utf8')
    emitAudit({
      op: 'create',
      entity: 'workflow-step-template',
      identifier: clean,
      projectId: this.projectId,
    })
    return this.ok({ saved: true, name: clean })
  }

  async deleteWorkflowStepTemplate() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate
    const tplDir = workflowStepTemplatesDir(root)
    const name = sanitiseAgentName(this.c.req.query('name') || '')
    if (!name) return this.badRequest('invalid name')
    try {
      await fs.unlink(path.join(tplDir, `${name}.json`))
      emitAudit({
        op: 'delete',
        entity: 'workflow-step-template',
        identifier: name,
        projectId: this.projectId,
      })
      return this.ok({ deleted: true, name })
    } catch {
      return this.notFound('not found')
    }
  }
}
