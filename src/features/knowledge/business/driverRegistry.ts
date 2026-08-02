import { joinPath, readTextFile } from '../../../core/lib/fileHelper.js'
import { loadYaml } from '../../../core/lib/yamlLib.js'
import { createFileDriver } from './fileDriver.js'

const SUPPORTED = ['file']

export async function loadKnowledgeConfig(devTeamRoot) {
  const configPath = joinPath(devTeamRoot, 'knowledge.config.yaml')
  try {
    const raw = await readTextFile(configPath)
    const cfg: any = loadYaml(raw) || {}
    const driver = cfg.driver || 'file'
    if (!SUPPORTED.includes(driver)) {
      return { driver: 'file', warning: `unsupported driver "${driver}", using file` }
    }
    return { driver, ...cfg }
  } catch {
    return { driver: 'file' }
  }
}

export async function getKnowledgeDriver(devTeamRoot) {
  const cfg = await loadKnowledgeConfig(devTeamRoot)
  if (cfg.driver === 'file') {
    return { driver: createFileDriver(devTeamRoot), config: cfg }
  }
  return { driver: createFileDriver(devTeamRoot), config: { driver: 'file' } }
}
