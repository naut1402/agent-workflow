import { AbstractBusiness } from '../../../core/business/AbstractBusiness.js'
import {
  loadAutoscanConfig,
  saveAutoscanConfig,
  loadGithubTokensConfig,
  saveGithubTokensConfig,
  loadLoggingConfig,
  saveLoggingConfig,
  loadRecoverySettings,
  saveRecoverySettings,
  loadScanPatternsConfig,
  saveScanPatternsConfig,
} from './dashboardSettings.js'
import { runAutoscan } from './autoscan.js'
import { browseDirectory } from './fsBrowse.js'

export class SettingsBusiness extends AbstractBusiness {
  getAutoscanConfig() {
    return loadAutoscanConfig()
  }

  saveAutoscanConfig(next: Parameters<typeof saveAutoscanConfig>[0]) {
    return saveAutoscanConfig(next)
  }

  runAutoscan(whitelist: string[]) {
    return runAutoscan(whitelist)
  }

  getGithubTokensConfig() {
    return loadGithubTokensConfig()
  }

  saveGithubTokensConfig(next: Parameters<typeof saveGithubTokensConfig>[0]) {
    return saveGithubTokensConfig(next)
  }

  getLoggingConfig() {
    return loadLoggingConfig()
  }

  saveLoggingConfig(next: Parameters<typeof saveLoggingConfig>[0]) {
    return saveLoggingConfig(next)
  }

  getRecoverySettings() {
    return loadRecoverySettings()
  }

  saveRecoverySettings(next: Parameters<typeof saveRecoverySettings>[0]) {
    return saveRecoverySettings(next)
  }

  getScanPatternsConfig() {
    return loadScanPatternsConfig()
  }

  saveScanPatternsConfig(next: Parameters<typeof saveScanPatternsConfig>[0]) {
    return saveScanPatternsConfig(next)
  }

  browseDirectory(pathParam?: string) {
    return browseDirectory(pathParam)
  }
}

export * from './dashboardSettings.js'
export * from './autoscan.js'
export * from './fsBrowse.js'
/** Peer surface for GitHub PAT helpers (clone / issue) — không phải project registry. */
export {
  parseGithubRepoRef,
  resolveGithubTokenForRepo,
} from '../schemas/githubTokens.js'
