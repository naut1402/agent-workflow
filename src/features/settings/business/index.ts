import { AbstractBusiness } from '../../../core/business/AbstractBusiness.js'
import { loadAutoscanConfig, saveAutoscanConfig, runAutoscan } from './autoscan/index.js'
import { loadGithubTokensConfig, saveGithubTokensConfig } from './autoscan/config.js'
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

  browseDirectory(pathParam?: string) {
    return browseDirectory(pathParam)
  }
}

export {
  loadAutoscanConfig,
  saveAutoscanConfig,
  runAutoscan,
  loadGithubTokensConfig,
  saveGithubTokensConfig,
  browseDirectory,
}
