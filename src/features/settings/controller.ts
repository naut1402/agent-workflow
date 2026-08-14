import { AbstractController } from '../../core/http/AbstractController.js'
import { parseAutoscanConfig } from './schemas/autoscan.js'
import { parseGithubTokensConfig } from './schemas/githubTokens.js'
import { parseLoggingConfig } from '../../core/log/loggingPrefs.js'
import { parseRecoverySettings } from './schemas/recovery.js'
import { emitAudit } from '../../core/log/store.js'
import {
  loadAutoscanConfig,
  saveAutoscanConfig,
  runAutoscan,
  loadGithubTokensConfig,
  saveGithubTokensConfig,
  loadLoggingConfig,
  saveLoggingConfig,
  loadRecoverySettings,
  saveRecoverySettings,
  browseDirectory,
} from './business/index.js'

export class SettingsController extends AbstractController {
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

  getLogging() {
    return this.ok({ config: loadLoggingConfig() })
  }

  async updateLogging() {
    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON')
    const current = loadLoggingConfig()
    const next = parseLoggingConfig({
      ...current,
      ...b.value,
      types: {
        ...current.types,
        ...(b.value?.types && typeof b.value.types === 'object' ? b.value.types : {}),
      },
    })
    const saved = saveLoggingConfig(next)
    emitAudit({ op: 'update', entity: 'logging', identifier: 'config', projectId: null })
    return this.ok({ config: saved })
  }

  getRecovery() {
    return this.ok({ config: loadRecoverySettings() })
  }

  async updateRecovery() {
    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON')
    const next = parseRecoverySettings({
      ...loadRecoverySettings(),
      ...b.value,
    })
    const saved = saveRecoverySettings(next)
    emitAudit({ op: 'update', entity: 'recovery', identifier: 'config', projectId: null })
    return this.ok({ config: saved })
  }
}
