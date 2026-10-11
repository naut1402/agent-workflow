import { joinPath, readTextFile } from '../../../backend/lib/fileHelper.js'
import { loadYaml } from '../../../backend/lib/yamlLib.js'
import { FileKnowledgeDriver } from './drivers/FileKnowledgeDriver.js'
import type { KnowledgeDriver } from './KnowledgeDriver.js'
import { resolveBases } from './knowledgeDb.js'

/**
 * Chỗ lắp ráp driver knowledge — nơi duy nhất biết hiện thực cụ thể.
 *
 * Thêm driver = thêm một dòng vào bảng; mọi business khác chỉ gọi
 * `getKnowledgeDriver` và chỉ biết `KnowledgeDriver`.
 */
const FACTORIES = new Map<string, (devTeamRoot: string) => KnowledgeDriver>([
  ['file', (devTeamRoot) => new FileKnowledgeDriver(resolveBases(devTeamRoot))],
])

const DEFAULT_DRIVER = 'file'

export async function loadKnowledgeConfig(devTeamRoot: string) {
  const configPath = joinPath(devTeamRoot, 'knowledge.config.yaml')
  try {
    const raw = await readTextFile(configPath)
    const cfg: any = loadYaml(raw) || {}
    const driver = cfg.driver || DEFAULT_DRIVER
    if (!FACTORIES.has(driver)) {
      return { driver: DEFAULT_DRIVER, warning: `unsupported driver "${driver}", using file` }
    }
    return { driver, ...cfg }
  } catch {
    return { driver: DEFAULT_DRIVER }
  }
}

export async function getKnowledgeDriver(devTeamRoot: string) {
  const cfg = await loadKnowledgeConfig(devTeamRoot)
  const factory = FACTORIES.get(cfg.driver)
  if (factory) return { driver: factory(devTeamRoot), config: cfg }
  return { driver: FACTORIES.get(DEFAULT_DRIVER)!(devTeamRoot), config: { driver: DEFAULT_DRIVER } }
}
