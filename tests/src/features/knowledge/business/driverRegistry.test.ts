import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getKnowledgeDriver, loadKnowledgeConfig } from '../../../../../src/features/knowledge/business/driverRegistry'

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'kn-cfg-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('loadKnowledgeConfig', () => {
  test('defaults to file driver when no config file', async () => {
    expect(await loadKnowledgeConfig(root)).toEqual({ driver: 'file' })
  })
  test('reads a valid file-driver config', async () => {
    await fs.writeFile(path.join(root, 'knowledge.config.yaml'), 'driver: file\nextra: 1\n')
    const cfg = await loadKnowledgeConfig(root)
    expect(cfg.driver).toBe('file')
    expect((cfg as any).extra).toBe(1)
  })
  test('falls back with a warning on an unsupported driver', async () => {
    await fs.writeFile(path.join(root, 'knowledge.config.yaml'), 'driver: postgres\n')
    const cfg = await loadKnowledgeConfig(root)
    expect(cfg.driver).toBe('file')
    expect((cfg as any).warning).toMatch(/unsupported/)
  })
})

describe('getKnowledgeDriver', () => {
  test('returns a usable file driver + config', async () => {
    const { driver, config } = await getKnowledgeDriver(root)
    expect(typeof driver.list).toBe('function')
    expect(config.driver).toBe('file')
  })
})
