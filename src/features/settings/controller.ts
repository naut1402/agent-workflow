import { AbstractController } from '../../core/http/AbstractController.js'
import { parseAutoscanConfig } from './schemas/autoscan.js'
import { parseGithubTokensConfig } from './schemas/githubTokens.js'
import { emitAudit } from '../logs/business/store.js'
import {
  loadAutoscanConfig,
  saveAutoscanConfig,
  runAutoscan,
  loadGithubTokensConfig,
  saveGithubTokensConfig,
  browseDirectory,
} from './business/index.js'

export class SettingsController extends AbstractController {
  // Project registry CRUD — no per-project root needed.
  getProjects() {
    const { registry } = this.ctx
    const id = this.c.req.query('id')
    if (id) {
      const project = registry.get(id)
      if (!project) return this.notFound('unknown project', { id })
      return this.ok({ project })
    }
    return this.ok(registry.list())
  }

  async createProject() {
    const { registry } = this.ctx
    let parsed: any
    try {
      parsed = JSON.parse((await this.c.req.text()) || '{}')
    } catch {
      return this.badRequest('invalid JSON')
    }
    const result = registry.add({ path: parsed.path, name: parsed.name })
    if ('error' in result) return this.json(result.status || 400, { error: result.error })
    emitAudit({
      op: 'create',
      entity: 'project',
      identifier: result.project?.id ?? null,
      projectId: result.project?.id ?? null,
    })
    return this.created({ project: result.project })
  }

  deleteProject() {
    const { registry } = this.ctx
    const id = this.c.req.query('id') || ''
    const result = registry.remove(id)
    if ('error' in result) return this.json(result.status || 400, { error: result.error })
    emitAudit({ op: 'delete', entity: 'project', identifier: id, projectId: id })
    return this.ok({ removed: true })
  }

  projectsMethodNotAllowed() {
    return this.methodNotAllowed()
  }

  /** Local filesystem directory browser (folder picker). */
  async browseFs() {
    // Missing query → default home; explicit empty / __roots__ handled in browseDirectory.
    const pathParam = this.c.req.query('path')
    const outcome = await browseDirectory(pathParam === undefined ? undefined : pathParam)
    if ('error' in outcome) return this.json(outcome.status || 400, { error: outcome.error })
    return this.ok(outcome.result)
  }

  getAutoscan() {
    return this.ok({ config: loadAutoscanConfig() })
  }

  async updateAutoscan() {
    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON')
    const next = parseAutoscanConfig({
      ...loadAutoscanConfig(),
      ...b.value,
    })
    const saved = saveAutoscanConfig(next)
    emitAudit({ op: 'update', entity: 'autoscan', identifier: 'config', projectId: null })
    return this.ok({ config: saved })
  }

  async runAutoscan() {
    const config = loadAutoscanConfig()
    // Optional body may override whitelist for a one-shot run (settings "scan now"
    // with unsaved edits); otherwise use persisted whitelist.
    const b = await this.parseBody()
    let whitelist = config.whitelist
    if (b.ok && Array.isArray(b.value?.whitelist)) {
      whitelist = b.value.whitelist.map((p: unknown) => String(p)).filter(Boolean)
    }
    if (!whitelist.length) {
      return this.ok({
        report: {
          scanned: 0,
          added: [],
          existing: [],
          skipped: [],
          errors: [],
          hits: [],
        },
      })
    }
    const report = await runAutoscan(whitelist)
    emitAudit({
      op: 'create',
      entity: 'autoscan',
      identifier: 'run',
      projectId: null,
      detail: { added: report.added.length, existing: report.existing.length },
    })
    return this.ok({ report })
  }

  getGithubTokens() {
    return this.ok({ config: loadGithubTokensConfig() })
  }

  async updateGithubTokens() {
    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON')
    const next = parseGithubTokensConfig(b.value)
    const saved = saveGithubTokensConfig(next)
    emitAudit({ op: 'update', entity: 'github-tokens', identifier: 'config', projectId: null })
    return this.ok({ config: saved })
  }
}
