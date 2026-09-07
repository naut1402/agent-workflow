import { AbstractController } from '../../core/http/AbstractController.js'
import { parseAutoscanConfig } from './schemas/autoscan.js'
import { parseGithubTokensConfig } from './schemas/githubTokens.js'
import { parseLoggingConfig } from '../../core/log/loggingPrefs.js'
import { parseRecoverySettings } from './schemas/recovery.js'
import { mergeScanPatternsConfig } from './schemas/scanPatterns.js'
import { parseSecurityConfig } from './schemas/security.js'
import { emitAudit } from '../../core/log/store.js'
import { hasJwtSecret } from '../../core/http/security/jwtGuard.js'
import * as settingsBusiness from './business/index.js'

export class SettingsController extends AbstractController {
  /** Local filesystem directory browser (folder picker). */
  async browseFs() {
    // Missing query → default home; explicit empty / __roots__ handled in browseDirectory.
    const pathParam = this.c.req.query('path')
    const outcome = await settingsBusiness.browseDirectory(pathParam === undefined ? undefined : pathParam)
    if ('error' in outcome) return this.json(outcome.status || 400, { error: outcome.error })
    return this.ok(outcome.result)
  }

  getAutoscan() {
    return this.ok({ config: settingsBusiness.loadAutoscanConfig() })
  }

  async updateAutoscan() {
    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON')
    const next = parseAutoscanConfig({
      ...settingsBusiness.loadAutoscanConfig(),
      ...b.value,
    })
    const saved = settingsBusiness.saveAutoscanConfig(next)
    emitAudit({ op: 'update', entity: 'autoscan', identifier: 'config', projectId: null })
    return this.ok({ config: saved })
  }

  async runAutoscan() {
    const config = settingsBusiness.loadAutoscanConfig()
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
    const report = await settingsBusiness.runAutoscan(whitelist)
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
    return this.ok({ config: settingsBusiness.loadGithubTokensConfig() })
  }

  async updateGithubTokens() {
    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON')
    const next = parseGithubTokensConfig(b.value)
    const saved = settingsBusiness.saveGithubTokensConfig(next)
    emitAudit({ op: 'update', entity: 'github-tokens', identifier: 'config', projectId: null })
    return this.ok({ config: saved })
  }

  getLogging() {
    return this.ok({ config: settingsBusiness.loadLoggingConfig() })
  }

  async updateLogging() {
    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON')
    const current = settingsBusiness.loadLoggingConfig()
    const next = parseLoggingConfig({
      ...current,
      ...b.value,
      types: {
        ...current.types,
        ...(b.value?.types && typeof b.value.types === 'object' ? b.value.types : {}),
      },
    })
    const saved = settingsBusiness.saveLoggingConfig(next)
    emitAudit({ op: 'update', entity: 'logging', identifier: 'config', projectId: null })
    return this.ok({ config: saved })
  }

  getRecovery() {
    return this.ok({ config: settingsBusiness.loadRecoverySettings() })
  }

  async updateRecovery() {
    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON')
    const next = parseRecoverySettings({
      ...settingsBusiness.loadRecoverySettings(),
      ...b.value,
    })
    const saved = settingsBusiness.saveRecoverySettings(next)
    emitAudit({ op: 'update', entity: 'recovery', identifier: 'config', projectId: null })
    return this.ok({ config: saved })
  }

  getScanPatterns() {
    return this.ok({ config: settingsBusiness.loadScanPatternsConfig() })
  }

  async updateScanPatterns() {
    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON')
    // Merge per kind so a body carrying only one kind leaves the other two alone.
    const next = mergeScanPatternsConfig(settingsBusiness.loadScanPatternsConfig(), b.value)
    const saved = settingsBusiness.saveScanPatternsConfig(next)
    emitAudit({ op: 'update', entity: 'scan-patterns', identifier: 'config', projectId: null })
    return this.ok({ config: saved })
  }

  getSecurity() {
    return this.ok({ config: settingsBusiness.loadSecurityConfig(), jwtEnabled: hasJwtSecret() })
  }

  async updateSecurity() {
    const b = await this.parseBody()
    if (!b.ok) return this.badRequest('invalid JSON')
    const current = settingsBusiness.loadSecurityConfig()
    const next = parseSecurityConfig({
      rateLimit: { ...current.rateLimit, ...(b.value?.rateLimit ?? {}) },
      cors: { ...current.cors, ...(b.value?.cors ?? {}) },
    })
    const saved = settingsBusiness.saveSecurityConfig(next)
    emitAudit({ op: 'update', entity: 'security', identifier: 'config', projectId: null })
    return this.ok({ config: saved, jwtEnabled: hasJwtSecret() })
  }
}
