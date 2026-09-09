import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadModulesUnder } from '../../../../src/core/lib/dirModuleLoader.js'

let root: string

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dir-module-loader-'))
  await fs.mkdir(path.join(root, 'alpha'))
  await fs.writeFile(path.join(root, 'alpha', 'api.ts'), 'export const id = "alpha"\n')
  await fs.mkdir(path.join(root, 'beta'))
  await fs.writeFile(path.join(root, 'beta', 'api.ts'), 'export const id = "beta"\n')
  await fs.mkdir(path.join(root, 'skip-me'))
  await fs.writeFile(path.join(root, 'skip-me', 'readme.txt'), 'no api\n')
  await fs.writeFile(path.join(root, 'file-at-root.txt'), 'ignore\n')
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('loadModulesUnder', () => {
  it('imports child dirs that have entryFile; skips others', async () => {
    const mods = await loadModulesUnder<{ id: string }>(root, { entryFile: 'api.ts' })
    expect(mods.map((m) => m.id).sort()).toEqual(['alpha', 'beta'])
  })

  it('returns [] when no child has entryFile', async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'dir-module-empty-'))
    try {
      await fs.mkdir(path.join(empty, 'alone'))
      expect(await loadModulesUnder(empty, { entryFile: 'api.ts' })).toEqual([])
    } finally {
      await fs.rm(empty, { recursive: true, force: true })
    }
  })
})
