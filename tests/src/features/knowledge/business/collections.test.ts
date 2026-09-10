import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  CollectionsFileError,
  createCollection,
  deleteCollection,
  listCollections,
  readCollectionsFile,
  readCollectionsFileSafe,
  renameTag,
  resolveCollectionEntries,
  updateCollection,
} from '../../../../../src/features/knowledge/business/collections'
import { createFileDriver, knowledgeRoot } from '../../../../../src/features/knowledge/business/fileDriver'

/**
 * Collection + tag admin ở mức business.
 *
 * `DEV_TEAM_DASHBOARD_HOME` cô lập vì scope `global` đọc thẳng registry home —
 * không cô lập thì case đếm entry ăn cả knowledge global thật của máy.
 */

let root: string
let driver: ReturnType<typeof createFileDriver>
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

const sidecar = (base: string) => path.join(base, 'collections.yaml')

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'kn-coll-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = path.join(root, '.home')
  driver = createFileDriver(root)
})
afterEach(async () => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  await fs.rm(root, { recursive: true, force: true })
})

describe('thành viên collection = entry_ids ∪ tags', () => {
  const entries = [
    { id: 'project/a', tags: ['x'] },
    { id: 'project/b', tags: ['x', 'y'] },
    { id: 'project/c', tags: [] },
  ]

  test('gộp hai đường gom, entry mang ĐỦ mọi tag của nhóm mới tính', () => {
    const got = resolveCollectionEntries({ id: 'g', name: 'g', tags: ['x', 'y'], entry_ids: ['project/c'] }, entries)
    expect(got.map((e) => e.id).sort()).toEqual(['project/b', 'project/c'])
  })

  test('id treo bị lọc lúc đọc, không cần job dọn (TC-T11)', () => {
    const got = resolveCollectionEntries({ id: 'g', name: 'g', entry_ids: ['project/a', 'project/đã-xoá'] }, entries)
    expect(got.map((e) => e.id)).toEqual(['project/a'])
  })
})

describe('CRUD collection', () => {
  test('nhóm rỗng tồn tại được và đếm đúng sau khi có thành viên (TC-T8 · TC-T9)', async () => {
    const made = await createCollection(root, { name: 'Nhóm A', scope: 'project' } as any)
    expect(made).toMatchObject({ collection: { id: 'nh-m-a', scope: 'project' } })
    expect((await listCollections(root)).collections[0].entryCount).toBe(0)

    await driver.write({ slug: 'm1', tags: ['grp'], content: 'c' })
    await updateCollection(root, 'nh-m-a', { name: 'Nhóm A', tags: ['grp'] } as any)
    expect((await listCollections(root)).collections[0].entryCount).toBe(1)
  })

  test('trùng id → 400, không ghi đè im lặng nhóm cũ (TC-T14)', async () => {
    await createCollection(root, { name: 'Trùng', scope: 'project' } as any)
    const again = await createCollection(root, { name: 'Trùng', scope: 'project' } as any)
    expect(again).toMatchObject({ status: 400 })
    expect((await listCollections(root)).collections).toHaveLength(1)
  })

  test('tên chuẩn hoá thành rỗng → 400', async () => {
    expect(await createCollection(root, { name: '///', scope: 'project' } as any)).toMatchObject({ status: 400 })
  })

  test('đổi tên giữ nguyên thành viên, xoá nhóm không xoá entry (TC-T12 · TC-T13)', async () => {
    await driver.write({ slug: 'keep', tags: ['grp'], content: 'c' })
    await createCollection(root, { name: 'C', scope: 'project', tags: ['grp'] } as any)
    await updateCollection(root, 'c', { name: 'C đổi tên', tags: ['grp'] } as any)

    const after = (await listCollections(root)).collections[0]
    expect(after).toMatchObject({ id: 'c', name: 'C đổi tên', entryCount: 1 })

    await deleteCollection(root, 'c')
    expect((await listCollections(root)).collections).toHaveLength(0)
    expect(await driver.list()).toHaveLength(1)
  })

  test('nhóm global và nhóm project nằm ở hai sidecar khác nhau (TC-T17)', async () => {
    await createCollection(root, { name: 'G', scope: 'global' } as any)
    await createCollection(root, { name: 'P', scope: 'project' } as any)

    const scopes = (await listCollections(root)).collections.map((c) => `${c.id}:${c.scope}`)
    expect(scopes.sort()).toEqual(['g:global', 'p:project'])
    expect(existsSync(sidecar(path.join(root, '.home', 'knowledge')))).toBe(true)
    expect(existsSync(sidecar(knowledgeRoot(root)))).toBe(true)
  })

  test('không đổi được scope của nhóm đã có', async () => {
    await createCollection(root, { name: 'S', scope: 'project' } as any)
    expect(await updateCollection(root, 's', { name: 'S', scope: 'global' } as any)).toMatchObject({ status: 400 })
  })
})

describe('sidecar hỏng', () => {
  const corrupt = 'collections: [\n  x: : :\n'

  function writeCorrupt(): string {
    const file = sidecar(knowledgeRoot(root))
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, corrupt)
    return file
  }

  test('thiếu file → doc rỗng; parse hỏng → ném', async () => {
    expect(await readCollectionsFile(knowledgeRoot(root))).toEqual({ version: 1, collections: [], tag_aliases: {} })
    writeCorrupt()
    expect(readCollectionsFile(knowledgeRoot(root))).rejects.toBeInstanceOf(CollectionsFileError)
  })

  test('bản Safe nuốt lỗi — đường ĐỌC entry không được chết theo', async () => {
    writeCorrupt()
    expect(await readCollectionsFileSafe(knowledgeRoot(root))).toEqual({ version: 1, collections: [], tag_aliases: {} })
    await driver.write({ slug: 'alive', content: 'c' })
    expect(await driver.list()).toHaveLength(1)
  })

  test('mọi đường ghi bị chặn, file trên đĩa còn nguyên', async () => {
    const file = writeCorrupt()
    for (const op of [
      () => createCollection(root, { name: 'X', scope: 'project' } as any),
      () => updateCollection(root, 'x', { name: 'X' } as any),
      () => deleteCollection(root, 'x'),
    ]) {
      expect(op()).rejects.toBeInstanceOf(CollectionsFileError)
    }
    expect(await fs.readFile(file, 'utf8')).toBe(corrupt)
  })
})

describe('renameTag', () => {
  test('đổi tên trên mọi entry mang tag và ghi alias tên cũ (TC-T1)', async () => {
    await driver.write({ slug: 'e1', tags: ['a'], content: 'c' })
    await driver.write({ slug: 'e2', tags: ['a', 'z'], content: 'c' })
    await driver.write({ slug: 'e3', tags: ['z'], content: 'c' })

    const res = await renameTag(root, { from: 'a', to: 'b' })
    expect(res).toMatchObject({ renamed: 2, alias: ['a', 'b'] })
    expect((await driver.read('project/e2')).tags.sort()).toEqual(['b', 'z'])
    expect((await driver.read('project/e3')).tags).toEqual(['z'])
    expect((await listCollections(root)).tagAliases).toEqual({ a: 'b' })

    // Alias phải ĐƯỢC DÙNG: lọc theo tên cũ vẫn ra đúng hai entry (TC-T2).
    expect((await driver.list({ tags: ['a'] })).map((e) => e.id).sort()).toEqual(['project/e1', 'project/e2'])
  })

  test('`to` bỏ trống = xoá tag, không tạo alias', async () => {
    await driver.write({ slug: 'e', tags: ['a', 'b'], content: 'c' })
    expect(await renameTag(root, { from: 'a' })).toMatchObject({ renamed: 1, alias: null })
    expect((await driver.read('project/e')).tags).toEqual(['b'])
    expect((await listCollections(root)).tagAliases).toEqual({})
  })

  test('rename cũng đổi tag của collection đang trỏ tới tên cũ', async () => {
    await driver.write({ slug: 'e', tags: ['a'], content: 'c' })
    await createCollection(root, { name: 'C', scope: 'project', tags: ['a'] } as any)
    await renameTag(root, { from: 'a', to: 'b' })

    const c = (await listCollections(root)).collections[0]
    expect(c.tags).toEqual(['b'])
    expect(c.entryCount).toBe(1)
  })

  test('from/to không hợp lệ → 400, không đụng entry nào (TC-T4)', async () => {
    await driver.write({ slug: 'e', tags: ['a'], content: 'c' })
    const before = await fs.readFile(path.join(knowledgeRoot(root), 'project', 'e.md'), 'utf8')

    expect(await renameTag(root, { from: '  ' })).toMatchObject({ status: 400 })
    expect(await renameTag(root, { from: 'a', to: '!!!' })).toMatchObject({ status: 400 })
    expect(await renameTag(root, { from: 'a', to: 'a' })).toMatchObject({ renamed: 0 })

    expect(await fs.readFile(path.join(knowledgeRoot(root), 'project', 'e.md'), 'utf8')).toBe(before)
  })

  test('rewrite hàng loạt KHÔNG xoá khoá front-matter lạ (TC-G13)', async () => {
    await driver.write({ slug: 'e', tags: ['a'], content: 'body' })
    const file = path.join(knowledgeRoot(root), 'project', 'e.md')
    await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('---\n\nbody', 'owner: tuan\n---\n\nbody'))

    await renameTag(root, { from: 'a', to: 'b' })

    const raw = await fs.readFile(file, 'utf8')
    expect(raw).toContain('owner: tuan')
    expect((await driver.read('project/e')).tags).toEqual(['b'])
  })
})
