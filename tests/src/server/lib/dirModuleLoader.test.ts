import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadEntriesUnder } from '../../../../src/backend/lib/dirModuleLoader.js'

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

// Ca một entry mỗi thư mục — trước #508 do `loadModulesUnder` (đã bỏ) đảm nhận.
describe('loadEntriesUnder — một entry', () => {
  it('imports child dirs that have entryFile; skips others', async () => {
    const entries = await loadEntriesUnder<{ id: string }>(root, { entryFiles: ['api.ts'] })
    expect(entries.map((e) => e.mod.id).sort()).toEqual(['alpha', 'beta'])
  })

  it('returns [] when no child has entryFile', async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'dir-module-empty-'))
    try {
      await fs.mkdir(path.join(empty, 'alone'))
      expect(await loadEntriesUnder(empty, { entryFiles: ['api.ts'] })).toEqual([])
    } finally {
      await fs.rm(empty, { recursive: true, force: true })
    }
  })
})

describe('loadEntriesUnder', () => {
  let tree: string

  beforeAll(async () => {
    tree = await fs.mkdtemp(path.join(os.tmpdir(), 'dir-entries-loader-'))
    // a: kiểu cũ (api.ts) + controller.ts
    await fs.mkdir(path.join(tree, 'a'))
    const put = (rel: string, id: string) => fs.writeFile(path.join(tree, rel), `export const id = ${JSON.stringify(id)}`)
    await put('a/api.ts', 'a/api')
    await put('a/controller.ts', 'a/controller')
    // b: chỉ controller.ts + controllers/*.ts (sắp theo tên, bỏ .d.ts / file không phải .ts / thư mục con)
    await fs.mkdir(path.join(tree, 'b', 'controllers', 'nested'), { recursive: true })
    await put('b/controller.ts', 'b/controller')
    await put('b/controllers/zeta.ts', 'b/zeta')
    await put('b/controllers/alpha.ts', 'b/alpha')
    await fs.writeFile(path.join(tree, 'b', 'controllers', 'types.d.ts'), 'export type X = 1')
    await fs.writeFile(path.join(tree, 'b', 'controllers', 'notes.md'), '# no')
    await put('b/controllers/nested/deep.ts', 'deep')
    // c: không có entry nào
    await fs.mkdir(path.join(tree, 'c'))
    await put('c/index.ts', 'c')
    await put('root-file.ts', 'root')
  })

  afterAll(async () => {
    await fs.rm(tree, { recursive: true, force: true })
  })

  it('nạp entryFiles theo thứ tự khai rồi entryDirs theo tên; bỏ thư mục không có entry', async () => {
    const got = await loadEntriesUnder<{ id: string }>(tree, {
      entryFiles: ['api.ts', 'controller.ts'],
      entryDirs: ['controllers'],
    })
    const rows = got.map((e) => `${e.dir}:${e.file}:${e.mod.id}`).sort()
    expect(rows).toEqual([
      'a:api.ts:a/api',
      'a:controller.ts:a/controller',
      'b:controller.ts:b/controller',
      'b:controllers/alpha.ts:b/alpha',
      'b:controllers/zeta.ts:b/zeta',
    ])
    // trong một thư mục: đúng thứ tự khai
    expect(got.filter((e) => e.dir === 'b').map((e) => e.file)).toEqual([
      'controller.ts',
      'controllers/alpha.ts',
      'controllers/zeta.ts',
    ])
    expect(got.filter((e) => e.dir === 'a').map((e) => e.file)).toEqual(['api.ts', 'controller.ts'])
  })

  it('không khai entryDirs → chỉ entryFiles', async () => {
    const got = await loadEntriesUnder<{ id: string }>(tree, { entryFiles: ['controller.ts'] })
    expect(got.map((e) => e.mod.id).sort()).toEqual(['a/controller', 'b/controller'])
  })
})
