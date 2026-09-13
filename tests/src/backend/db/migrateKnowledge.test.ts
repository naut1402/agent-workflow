import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { migrateKnowledgeToSqlite } from '../../../../src/backend/db/migrateKnowledge'
import { resetDbForTest } from '../../../../src/backend/db/client'
import { listCollections } from '../../../../src/features/knowledge/business/collections'
import { createFileDriver } from '../../../../src/features/knowledge/business/fileDriver'

/**
 * Lệnh migrate `collections.yaml` → `dashboard.sqlite`.
 *
 * Hai bất biến đắt nhất: **idempotent** (chạy lại không nhân đôi, và không đè
 * bản đã sửa trên dashboard) và **chỉ đọc nguồn** (YAML ở lại làm bản lưu).
 *
 * Nguồn project lấy qua `DEV_TEAM_ROOT` — registry thật nằm dưới
 * `DEV_TEAM_DASHBOARD_HOME` đã cô lập nên `loadRegistry()` trả rỗng, đúng thứ
 * mình muốn: suite không đụng project thật nào của máy.
 */

let root: string
let home: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME
const prevRoot = process.env.DEV_TEAM_ROOT

const YAML = `version: 1
collections:
  - id: nhom-cu
    name: Nhóm cũ
    description: mô tả
    tags: [vue]
    entry_ids: [project/a]
  - id: nhom-rong
    name: Nhóm rỗng
tag_aliases:
  old: vue
`

const sidecar = () => path.join(root, 'knowledge', 'collections.yaml')

async function writeSidecar(body = YAML) {
  await fs.mkdir(path.dirname(sidecar()), { recursive: true })
  await fs.writeFile(sidecar(), body)
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'kn-mig-'))
  home = path.join(root, '.home')
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  process.env.DEV_TEAM_ROOT = root
  resetDbForTest()
})
afterEach(async () => {
  resetDbForTest()
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  if (prevRoot === undefined) delete process.env.DEV_TEAM_ROOT
  else process.env.DEV_TEAM_ROOT = prevRoot
  await fs.rm(root, { recursive: true, force: true })
})

const ofStore = (results: Awaited<ReturnType<typeof migrateKnowledgeToSqlite>>) =>
  results.find((r) => r.storeKey === path.join(root, 'knowledge'))!

describe('nạp sidecar vào bảng', () => {
  test('chuyển đủ collection + alias, giữ nguyên id và ngày tạo', async () => {
    await writeSidecar()
    expect(ofStore(await migrateKnowledgeToSqlite())).toMatchObject({
      sourceExists: true,
      collections: 2,
      aliases: 1,
      skipped: 0,
    })

    const { collections, tagAliases } = await listCollections(root)
    expect(collections.map((c) => c.id).sort()).toEqual(['nhom-cu', 'nhom-rong'])
    expect(collections.find((c) => c.id === 'nhom-cu')).toMatchObject({
      name: 'Nhóm cũ',
      description: 'mô tả',
      tags: ['vue'],
      entry_ids: ['project/a'],
    })
    expect(tagAliases).toEqual({ old: 'vue' })
  })

  test('thành viên resolve lại đúng sau khi chuyển (entry_ids ∪ tags)', async () => {
    await writeSidecar()
    const driver = createFileDriver(root)
    await driver.write({ slug: 'a', content: 'c' })
    await driver.write({ slug: 'b', tags: ['vue'], content: 'c' })
    await driver.write({ slug: 'c', content: 'c' })
    await migrateKnowledgeToSqlite()

    expect((await listCollections(root)).collections.find((c) => c.id === 'nhom-cu')!.entryCount).toBe(2)
  })

  test('store chưa từng có sidecar thì bỏ qua im lặng, không báo lỗi', async () => {
    const results = await migrateKnowledgeToSqlite()
    expect(ofStore(results)).toMatchObject({ sourceExists: false, collections: 0 })
  })
})

describe('idempotent (G6 · E3)', () => {
  test('chạy lần hai không thêm hàng nào', async () => {
    await writeSidecar()
    await migrateKnowledgeToSqlite()
    const again = ofStore(await migrateKnowledgeToSqlite())

    expect(again).toMatchObject({ sourceExists: true, collections: 0, skipped: 2 })
    expect((await listCollections(root)).collections).toHaveLength(2)
  })

  /** Bản đã sửa trên dashboard 🚫 không được YAML cũ ghi đè ở lần chạy sau. */
  test('bản ghi đã sửa trên dashboard sống sót qua lần chạy thứ hai', async () => {
    await writeSidecar()
    await migrateKnowledgeToSqlite()

    const { updateCollection } = await import('../../../../src/features/knowledge/business/collections')
    await updateCollection(root, 'nhom-cu', { name: 'Tên mới', tags: [] } as any)
    await migrateKnowledgeToSqlite()

    expect((await listCollections(root)).collections.find((c) => c.id === 'nhom-cu')!.name).toBe('Tên mới')
  })
})

describe('nguồn chỉ đọc', () => {
  test('`collections.yaml` còn nguyên byte sau khi chạy', async () => {
    await writeSidecar()
    await migrateKnowledgeToSqlite()
    expect(await fs.readFile(sidecar(), 'utf8')).toBe(YAML)
  })

  /** Một project hỏng 🚫 không được chặn mọi project còn lại. */
  test('sidecar hỏng thì bỏ qua store đó và đi tiếp, không ném', async () => {
    await writeSidecar('collections: [\n  x: : :\n')
    const results = await migrateKnowledgeToSqlite()
    expect(ofStore(results)).toMatchObject({ sourceExists: false, collections: 0 })
    expect((await listCollections(root)).collections).toHaveLength(0)
  })
})
