import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { AbstractController } from '../../core/http/AbstractController.js'
import { statSafe } from '../../core/contracts/fs.js'
import { sanitiseProfileName } from '../../core/contracts/sanitize.js'
import { draftFromAgentMarkdown } from '../../core/contracts/agentMarkdown.js'
import { parseFrontmatter } from '../../core/contracts/frontmatter.js'
import { emitAudit } from '../logs/business/store.js'
import { profilesDir, scanCustomAgents, customAgentsDir } from '../agent-editor/business/index.js'
import { buildCatalog, parseCatalogAgentId, resolveCatalogAgentPath } from './business/catalog/index.js'
import { buildRules } from './business/rules/index.js'

export class PipelineEditorController extends AbstractController {
  async getPipelineProfiles() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate

    const dir = profilesDir(root)
    const nameParam = this.c.req.query('name')
    if (nameParam) {
      const name = sanitiseProfileName(nameParam)
      if (!name) return this.badRequest('invalid profile name')
      try {
        const raw = await fs.readFile(path.join(dir, `${name}.yaml`), 'utf8')
        return this.ok({ name, pipeline: yaml.load(raw) })
      } catch {
        return this.notFound('profile not found')
      }
    }
    try {
      const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.yaml'))
      const profiles = await Promise.all(
        files.map(async (f) => {
          const s = await statSafe(path.join(dir, f))
          return { name: f.replace(/\.yaml$/, ''), mtime: s.mtime }
        }),
      )
      return this.ok({ profiles })
    } catch {
      return this.ok({ profiles: [] })
    }
  }

  async createPipelineProfile() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate

    const dir = profilesDir(root)
    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON')
    const name = sanitiseProfileName(b.value.name)
    if (!name) return this.badRequest('invalid profile name')
    if (!b.value.pipeline || !Array.isArray(b.value.pipeline.steps)) {
      return this.badRequest('pipeline.steps must be an array')
    }
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, `${name}.yaml`), yaml.dump(b.value.pipeline, { lineWidth: 120 }), 'utf8')
    emitAudit({ op: 'create', entity: 'pipeline-profile', identifier: name, projectId: this.projectId })
    return this.ok({ saved: true, name })
  }

  async deletePipelineProfile() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate

    const dir = profilesDir(root)
    const name = sanitiseProfileName(this.c.req.query('name') || '')
    if (!name) return this.badRequest('invalid profile name')
    try {
      await fs.unlink(path.join(dir, `${name}.yaml`))
      emitAudit({ op: 'delete', entity: 'pipeline-profile', identifier: name, projectId: this.projectId })
      return this.ok({ deleted: true, name })
    } catch {
      return this.notFound('profile not found')
    }
  }

  async writePipelineConfig() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate

    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON')
    const { scope, taskId, pipeline } = b.value
    if (!pipeline || !Array.isArray(pipeline.steps)) {
      return this.badRequest('pipeline.steps must be an array')
    }
    let target: string
    if (scope === 'global') {
      target = path.join(root, 'pipeline.yaml')
    } else if (scope === 'task' && taskId) {
      if (/[^\w\-]/.test(taskId)) return this.badRequest('invalid taskId')
      const taskDir = path.join(root, 'tasks', taskId)
      await fs.mkdir(taskDir, { recursive: true })
      target = path.join(taskDir, 'pipeline.yaml')
    } else {
      return this.badRequest('scope must be "global" or "task" (with taskId)')
    }
    const toWrite = scope === 'task' ? { ...pipeline, steps_replace: true } : pipeline
    await fs.writeFile(target, yaml.dump(toWrite, { lineWidth: 120 }), 'utf8')
    emitAudit({
      op: 'update',
      entity: 'pipeline',
      identifier: scope === 'task' ? taskId : 'global',
      projectId: this.projectId,
      detail: { scope },
    })
    return this.ok({ written: true, scope, target })
  }

  async getCatalog() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate

    return this.ok(await buildCatalog(root, { scanCustomAgents }))
  }

  async getCatalogAgent() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate

    const id = this.c.req.query('id')
    if (!id) return this.badRequest('missing id')
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
    if (!agentPath) return this.notFound('agent file not found')
    try {
      const raw = await fs.readFile(agentPath, 'utf8')
      const meta = parseCatalogAgentId(id)
      const draft = draftFromAgentMarkdown(raw, yaml, { name: meta?.name, description: '' })
      const fm = parseFrontmatter(raw)
      if (fm.description) draft.description = fm.description
      if (Array.isArray(fm.skills) && fm.skills.length) draft.skills = [...fm.skills]
      return this.ok({ id, path: agentPath, content: raw, draft })
    } catch (e: any) {
      return this.json(500, { error: String(e.message || e) })
    }
  }

  async getRules() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate

    return this.ok(await buildRules(root))
  }
}
