import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  createCollection,
  deleteCollection,
  findCollectionSafe,
  listCollections,
  renameTag,
  resolveCollectionEntries,
  updateCollection,
} from '../../../../../src/features/knowledge/business/collections'
import { createTag, listTagMeta } from '../../../../../src/features/knowledge/business/tags'
import { createFileDriver, knowledgeRoot } from '../../../../../src/features/knowledge/business/fileDriver'
import { resetDbForTest } from '../../../../../src/backend/db/client'

/**
 * Collection + tag admin ở mức business, nguồn là `dashboard.sqlite`.
 *
 * ⚠️ Hai bước cô lập, thiếu bước nào cũng hỏng:
 * - `DEV_TEAM_DASHBOARD_HOME` — `dashboard.sqlite` **và** store `global` đều
 *   nằm dưới registry home; không cô lập là suite ghi vào DB thật của máy.
 * - `resetDbForTest()` **sau** khi đổi biến môi trường — `getDb()` cache
 *   connection theo process, và `bun test` chạy nhiều file trong cùng process,
 *   nên không reset thì mọi truy vấn vẫn trỏ file của test trước.
 */

let root: string
let driver: ReturnType<typeof createFileDriver>
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'kn-coll-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = path.join(root, '.home')
  resetDbForTest()
  driver = createFileDriver(root)
})
afterEach(async () => {
  resetDbForTest()
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
    // Id đi qua `slugify` (NFD + đ→d) nên còn đọc được, không phải `nh-m-a`.
    expect(made).toMatchObject({ collection: { id: 'nhom-a', scope: 'project' } })
    expect((await listCollections(root)).collections[0].entryCount).toBe(0)

    await driver.write({ slug: 'm1', tags: ['grp'], content: 'c' })
    await updateCollection(root, 'nhom-a', { name: 'Nhóm A', tags: ['grp'] } as any)
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

  test('không đổi được scope của nhóm đã có', async () => {
    await createCollection(root, { name: 'S', scope: 'project' } as any)
    expect(await updateCollection(root, 's', { name: 'S', scope: 'global' } as any)).toMatchObject({ status: 400 })
  })

  test('id lạ → 404 ở cả update lẫn delete', async () => {
    expect(await updateCollection(root, 'khong-co', { name: 'X' } as any)).toMatchObject({ status: 404 })
    expect(await deleteCollection(root, 'khong-co')).toMatchObject({ status: 404 })
  })
})

describe('phân vùng theo store_key', () => {
  test('nhóm global và nhóm project là hai hàng độc lập (TC-T17)', async () => {
    await createCollection(root, { name: 'G', scope: 'global' } as any)
    await createCollection(root, { name: 'P', scope: 'project' } as any)

    const scopes = (await listCollections(root)).collections.map((c) => `${c.id}:${c.scope}`)
    expect(scopes.sort()).toEqual(['g:global', 'p:project'])
  })

  /**
   * Hai project **khác thư mục** thì `store_key` khác nhau ⇒ nhóm không lẫn
   * sang nhau. Đây là bất biến thay cho "mỗi store một `collections.yaml`".
   */
  test('hai project khác nhau không thấy nhóm của nhau (TC-T18)', async () => {
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'kn-other-'))
    try {
      await createCollection(root, { name: 'Của A', scope: 'project' } as any)
      await createCollection(other, { name: 'Của B', scope: 'project' } as any)

      expect((await listCollections(root)).collections.map((c) => c.id)).toEqual(['cua-a'])
      expect((await listCollections(other)).collections.map((c) => c.id)).toEqual(['cua-b'])
    } finally {
      await fs.rm(other, { recursive: true, force: true })
    }
  })

  test('`system` dùng CHUNG store với `project` — entry system vẫn vào nhóm project', async () => {
    await driver.write({ slug: 's1', scope: 'system', tags: ['grp'], content: 'c' })
    await createCollection(root, { name: 'C', scope: 'project', tags: ['grp'] } as any)
    expect((await listCollections(root)).collections[0].entryCount).toBe(1)
  })
})

describe('findCollectionSafe — đường ĐỌC entry', () => {
  test('trả nhóm khi có, null khi id lạ; lọc `list({ collection })` khớp', async () => {
    await driver.write({ slug: 'in', tags: ['grp'], content: 'c' })
    await driver.write({ slug: 'out', content: 'c' })
    await createCollection(root, { name: 'C', scope: 'project', tags: ['grp'] } as any)

    expect(await findCollectionSafe(root, 'c')).toMatchObject({ id: 'c', tags: ['grp'] })
    expect(await findCollectionSafe(root, 'khong-co')).toBeNull()
    expect((await driver.list({ collection: 'c' })).map((e) => e.id)).toEqual(['project/in'])
  })

  /** Nhóm không tồn tại ⇒ **rỗng**, 🚫 không phải "trả hết": lọc hụt an toàn hơn lọc thừa. */
  test('lọc theo nhóm không tồn tại trả rỗng, không trả toàn bộ', async () => {
    await driver.write({ slug: 'x', content: 'c' })
    expect(await driver.list({ collection: 'khong-co' })).toHaveLength(0)
  })
})

describe('renameTag', () => {
  test('đổi tên trên mọi entry mang tag và ghi alias tên cũ (TC-T1 · TC-T2)', async () => {
    await driver.write({ slug: 'e1', tags: ['a'], content: 'c' })
    await driver.write({ slug: 'e2', tags: ['a', 'z'], content: 'c' })
    await driver.write({ slug: 'e3', tags: ['z'], content: 'c' })

    const res = await renameTag(root, { from: 'a', to: 'b' })
    expect(res).toMatchObject({ renamed: 2, alias: ['a', 'b'] })
    expect((await driver.read('project/e2')).tags.sort()).toEqual(['b', 'z'])
    expect((await driver.read('project/e3')).tags).toEqual(['z'])
    expect((await listCollections(root)).tagAliases).toEqual({ a: 'b' })

    // Alias phải ĐƯỢC DÙNG: lọc theo tên cũ vẫn ra đúng hai entry.
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

  /**
   * TC-41c — tag **0 entry** là trạng thái hợp lệ từ khi tag là thực thể, nên
   * `renamed: 0` 🚫 không được biến thành "không ghi gì cả": alias và tag của
   * collection vẫn phải chuyển, nếu không hàm trả `alias` mô tả một hàng chưa
   * tồn tại.
   */
  test('đổi tên tag KHÔNG có entry nào vẫn ghi alias + dời tag của nhóm (TC-41c)', async () => {
    await createTag(root, { tag: 'alpha', color: 'blue', scope: 'project' } as any)
    await createCollection(root, { name: 'Nhom A', scope: 'project', tags: ['alpha'] } as any)

    expect(await renameTag(root, { from: 'alpha', to: 'beta' })).toMatchObject({
      renamed: 0,
      alias: ['alpha', 'beta'],
    })
    expect((await listCollections(root)).tagAliases).toEqual({ alpha: 'beta' })
    expect((await listCollections(root)).collections[0].tags).toEqual(['beta'])
    expect((await listTagMeta(root)).map((m) => m.tag)).toEqual(['beta'])
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
