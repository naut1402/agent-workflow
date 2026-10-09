import fs from 'node:fs/promises'
import path from 'node:path'
import { loadYaml, dumpYaml } from '../../backend/lib/yamlLib.js'
import { AbstractController } from '../../backend/http/AbstractController.js'
import { statSafe, writeTextFileAtomicSync } from '../../backend/lib/fileHelper.js'
import * as pipelineEditorBusiness from './business/index.js'
import { draftFromAgentMarkdown } from '../agent-editor/business/agentMarkdown.js'
import { parseFrontmatter } from '../../backend/lib/yamlLib.js'
import { emitAudit } from '../../backend/log/store.js'
import {
  buildCatalog,
  parseCatalogItemId,
  resolveCatalogAgentPath,
  resolveCatalogSkillPath,
} from './business/catalog/index.js'
import { buildRules, resolveRuleContentPathWithPatterns } from './business/rules/index.js'

// xem docs/architecture/code/pipeline-editor.md §7
function validatePipelinePayload(pipeline: any): string | null {
  for (const step of pipeline.steps ?? []) {
    if (typeof step?.id === 'string' && step.id.startsWith('__')) {
      return `step id must not start with "__": ${step.id}`
    }
    const runnerId = step?.runner_id
    if (runnerId != null && runnerId !== '') {
      if (typeof runnerId !== 'string') return `invalid step runner_id: ${step?.id}`
      if (pipelineEditorBusiness.sanitiseRunnerId(runnerId) !== runnerId) {
        return `invalid step runner_id: ${step?.id}`
      }
    }
  }
  const agent = pipeline.orchestrator?.agent
  if (agent != null && agent !== '') {
    if (typeof agent !== 'string') return 'invalid orchestrator.agent'
    const segments = agent.split(':')
    if (segments.some((seg) => pipelineEditorBusiness.sanitiseAgentName(seg) !== seg)) {
      return 'invalid orchestrator.agent'
    }
  }
  return null
}

export class PipelineEditorController extends AbstractController {
  async getPipelineProfiles() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate

    const dir = pipelineEditorBusiness.profilesDir(root)
    const nameParam = this.c.req.query('name')
    if (nameParam) {
      const name = pipelineEditorBusiness.sanitiseProfileName(nameParam)
      if (!name) return this.badRequest('invalid profile name')
      try {
        const raw = await fs.readFile(path.join(dir, `${name}.yaml`), 'utf8')
        if (this.c.req.query('download') === '1') {
          this.c.header('Content-Disposition', `attachment; filename="${name}.yaml"`)
          this.c.header('Cache-Control', 'no-store')
          return this.c.text(raw, 200, { 'Content-Type': 'text/yaml; charset=utf-8' })
        }
        return this.ok({ name, pipeline: loadYaml(raw) })
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

    const dir = pipelineEditorBusiness.profilesDir(root)
    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON')
    const name = pipelineEditorBusiness.sanitiseProfileName(b.value.name)
    if (!name) return this.badRequest('invalid profile name')
    if (!b.value.pipeline || !Array.isArray(b.value.pipeline.steps)) {
      return this.badRequest('pipeline.steps must be an array')
    }
    const invalid = validatePipelinePayload(b.value.pipeline)
    if (invalid) return this.badRequest(invalid)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, `${name}.yaml`), dumpYaml(b.value.pipeline), 'utf8')
    emitAudit({ op: 'create', entity: 'pipeline-profile', identifier: name, projectId: this.projectId })
    return this.ok({ saved: true, name })
  }

  async deletePipelineProfile() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate

    const dir = pipelineEditorBusiness.profilesDir(root)
    const name = pipelineEditorBusiness.sanitiseProfileName(this.c.req.query('name') || '')
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
    const invalid = validatePipelinePayload(pipeline)
    if (invalid) return this.badRequest(invalid)
    let target: string
    if (scope === 'global') {
      target = path.join(root, 'pipeline.yaml')
    } else if (scope === 'task' && taskId) {
      if (/[^\w\-]/.test(taskId)) return this.badRequest('invalid taskId')
      const stateFile = path.join(root, '.dev-state', `${taskId}.json`)
      try {
        const state = JSON.parse(await fs.readFile(stateFile, 'utf8')) as {
          archived?: unknown
          current_phase?: unknown
        }
        if (state?.archived === true || state?.current_phase === 'completed') {
          return this.badRequest('cannot write pipeline for archived or completed task')
        }
      } catch {
        /* missing/corrupt state — allow (new task override) */
      }
      const taskDir = path.join(root, 'tasks', taskId)
      await fs.mkdir(taskDir, { recursive: true })
      target = path.join(taskDir, 'pipeline.yaml')
    } else {
      return this.badRequest('scope must be "global" or "task" (with taskId)')
    }
    const toWrite = scope === 'task' ? { ...pipeline, steps_replace: true } : pipeline
    // xem docs/architecture/code/pipeline-editor.md §8
    writeTextFileAtomicSync(target, dumpYaml(toWrite))
    if (scope === 'task' && taskId) {
      try {
        const { applyOrchestratorConfigChange, reconcileGateState } = await import('../monitor/business/index.js')
        await reconcileGateState(root, taskId)
        const enabled = pipeline.orchestrator?.enabled === true
        await applyOrchestratorConfigChange(root, taskId, enabled)
        if (enabled) {
          const { ensureSweepScheduled } = await import('../orchestrator/business/index.js')
          ensureSweepScheduled()
        }
      } catch (err) {
        console.warn('[pipeline-editor] orchestrator state sync failed', err)
      }
    }
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

    return this.ok(await buildCatalog(root, {
      scanCustomAgents: pipelineEditorBusiness.scanCustomAgents,
      scanPatterns: pipelineEditorBusiness.loadScanPatternsConfig(),
    }))
  }

  async getCatalogAgent() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate

    const id = this.c.req.query('id')
    if (!id) return this.badRequest('missing id')
    const projectRoot = path.dirname(root)
    let agentPath = await resolveCatalogAgentPath(projectRoot, root, id, {
      customAgentsDir: pipelineEditorBusiness.customAgentsDir,
      scanPatterns: pipelineEditorBusiness.loadScanPatternsConfig().agents,
    })
    if (!agentPath) {
      const parsed = parseCatalogItemId(id)
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
      const meta = parseCatalogItemId(id)
      const draft = draftFromAgentMarkdown(raw, { name: meta?.name, description: '' })
      const fm = parseFrontmatter(raw)
      if (fm.description) draft.description = fm.description
      if (Array.isArray(fm.skills) && fm.skills.length) draft.skills = [...fm.skills]
      return this.ok({ id, path: agentPath, content: raw, draft })
    } catch (e: any) {
      if (e?.code === 'ENOENT') return this.notFound('agent file not found')
      return this.json(500, { error: String(e.message || e) })
    }
  }

  async getSkillContent() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate

    const id = this.c.req.query('id')
    if (!id) return this.badRequest('missing id')
    const projectRoot = path.dirname(root)
    let skillPath = await resolveCatalogSkillPath(projectRoot, id, {
      sanitiseName: pipelineEditorBusiness.sanitiseAgentName,
      scanPatterns: pipelineEditorBusiness.loadScanPatternsConfig().skills,
    })
    if (!skillPath) {
      const parsed = parseCatalogItemId(id)
      // xem docs/architecture/code/pipeline-editor.md §9
      if (parsed?.source?.startsWith('repo:') && pipelineEditorBusiness.sanitiseAgentName(parsed.name) === parsed.name) {
        const pluginName = parsed.source.slice('repo:'.length)
        if (pipelineEditorBusiness.sanitiseAgentName(pluginName) === pluginName) {
          const pluginsDir = path.resolve(projectRoot, 'plugins')
          const builtin = path.resolve(pluginsDir, pluginName, 'skills', parsed.name, 'SKILL.md')
          if (builtin.startsWith(pluginsDir + path.sep)) {
            try {
              await fs.access(builtin)
              skillPath = builtin
            } catch {
              /* not found */
            }
          }
        }
      }
    }
    if (!skillPath) return this.notFound('skill file not found')
    try {
      const raw = await fs.readFile(skillPath, 'utf8')
      return this.ok({ id, content: raw })
    } catch (e: any) {
      return this.json(500, { error: String(e.message || e) })
    }
  }

  async getRules() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate

    return this.ok(await buildRules(root, {
      scanPatterns: pipelineEditorBusiness.loadScanPatternsConfig(),
    }))
  }

  async getRuleContent() {
    const gate = this.requireRoot()
    if ('error' in gate) return gate.error
    const { root } = gate

    const id = this.c.req.query('id')
    if (!id) return this.badRequest('missing id')
    const projectRoot = path.dirname(root)
    const rulePath = await resolveRuleContentPathWithPatterns(projectRoot, id, {
      scanPatterns: pipelineEditorBusiness.loadScanPatternsConfig(),
    })
    if (!rulePath) return this.notFound('rule file not found')
    try {
      const raw = await fs.readFile(rulePath, 'utf8')
      return this.ok({ id, content: raw })
    } catch (e: any) {
      if (e?.code === 'ENOENT') return this.notFound('rule file not found')
      return this.json(500, { error: String(e.message || e) })
    }
  }
}
