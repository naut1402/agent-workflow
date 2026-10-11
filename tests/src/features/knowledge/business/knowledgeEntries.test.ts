import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  getKnowledgeDriver,
  knowledgeRoot,
  listKnowledge,
  listKnowledgeTags,
  loadKnowledgeBundle,
  type KnowledgeDriver,
} from '../../../../../src/features/knowledge/business/index'
import { resetDbForTest } from '../../../../../src/backend/db/client'
import { MAX_BUNDLE_BYTES } from '../../../../../src/features/knowledge/schemas/knowledge'

let root: string
let home: string
let driver: KnowledgeDriver
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

/**
 * `DEV_TEAM_DASHBOARD_HOME` phải cô lập: scope `global` đọc thẳng registry
 * home, nên không cô lập thì suite ăn cả knowledge global thật của máy đang
 * chạy — xanh trên CI trống, đỏ ngẫu nhiên trên máy dev.
 */
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'kn-'))
  home = path.join(root, '.home')
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  // Rule đọc đụng DB qua alias tag / lọc theo nhóm — reset để không dùng lại
  // connection trỏ home của test trước (getDb cache theo process).
  resetDbForTest()
  driver = (await getKnowledgeDriver(root)).driver
})
afterEach(async () => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  await fs.rm(root, { recursive: true, force: true })
})

describe('list', () => {
  beforeEach(async () => {
    await driver.write({ slug: 'alpha', scope: 'project', tags: ['x'], content: 'find-me' })
    await driver.write({ slug: 'beta', scope: 'system', tags: ['y'], content: 'other' })
  })
  test('returns metadata without content', async () => {
    const all = await listKnowledge(driver, root)
    expect(all).toHaveLength(2)
    expect((all[0] as any).content).toBeUndefined()
  })
  test('filters by scope, tags, query', async () => {
    expect(await listKnowledge(driver, root, { scope: 'system' })).toHaveLength(1)
    expect(await listKnowledge(driver, root, { tags: ['x'] })).toHaveLength(1)
    const q = await listKnowledge(driver, root, { query: 'find-me' })
    expect(q).toHaveLength(1)
    expect(q[0].slug).toBe('alpha')
  })
})

describe('listKnowledgeTags', () => {
  test('counts tags; entry đã xoá không còn trong danh sách', async () => {
    await driver.write({ slug: 'a', tags: ['t1', 't2'], content: 'c' })
    await driver.write({ slug: 'b', tags: ['t1'], content: 'c' })
    const tags = await listKnowledgeTags(driver)
    expect(tags).toEqual([{ tag: 't1', count: 2 }, { tag: 't2', count: 1 }])
    expect(await driver.delete('project/a')).toEqual({ deleted: true, id: 'project/a' })
    expect(await listKnowledge(driver, root)).toHaveLength(1)
  })
})

describe('loadKnowledgeBundle', () => {
  test('returns content for found ids and error for missing', async () => {
    await driver.write({ slug: 'k', scope: 'project', content: 'kc' })
    const bundle = await loadKnowledgeBundle(root, ['project/k', 'project/missing'])
    expect(bundle[0]).toMatchObject({ id: 'project/k' })
    expect((bundle[0] as { content: string }).content.trim()).toBe('kc')
    expect(bundle[1]).toMatchObject({ id: 'project/missing', error: 'not found' })
  })
  test('empty ids → []', async () => {
    expect(await loadKnowledgeBundle(root, [])).toEqual([])
  })
})

describe('scope global — đa root', () => {
  test('project khác cùng home đọc được entry global, không thấy entry project (TC-G2 · TC-G3)', async () => {
    await driver.write({ slug: 'shared', scope: 'global', content: 'g' })
    await driver.write({ slug: 'mine', scope: 'project', content: 'p' })

    const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kn-other-'))
    try {
      const ids = (await listKnowledge((await getKnowledgeDriver(otherRoot)).driver, otherRoot)).map((e) => e.id)
      expect(ids).toEqual(['global/shared'])
    } finally {
      await fs.rm(otherRoot, { recursive: true, force: true })
    }
  })

  test('scope lạ trả rỗng và KHÔNG đẻ thư mục (TC-G7)', async () => {
    await driver.write({ slug: 'a', content: 'c' })
    expect(await listKnowledge(driver, root, { scope: 'Global' })).toEqual([])
    expect(await fs.readdir(knowledgeRoot(root))).not.toContain('Global')
  })

  test('chỉ đọc thì không tạo thư mục nào trên đĩa (TC-G10)', async () => {
    expect(await listKnowledge(driver, root)).toEqual([])
    expect(await listKnowledgeTags(driver)).toEqual([])
    await expect(fs.stat(home)).rejects.toThrow()
    await expect(fs.stat(knowledgeRoot(root))).rejects.toThrow()
  })
})

describe('cap byte của bundle (TC-I7)', () => {
  test('entry to bị từ chối KHÔNG làm hỏng entry đứng sau nó', async () => {
    await driver.write({ slug: 'small-1', content: 'a'.repeat(1000) })
    await driver.write({ slug: 'huge', content: 'b'.repeat(MAX_BUNDLE_BYTES) })
    await driver.write({ slug: 'small-2', content: 'c'.repeat(1000) })

    const bundle = await loadKnowledgeBundle(root, ['project/small-1', 'project/huge', 'project/small-2'])

    expect('content' in bundle[0]).toBe(true)
    expect(bundle[1]).toEqual({ id: 'project/huge', error: 'bundle size limit' })
    // Byte của entry bị từ chối không được tính vào tổng.
    expect('content' in bundle[2]).toBe(true)
  })
})

