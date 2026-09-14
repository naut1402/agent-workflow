import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  createTag,
  decorateTagFacets,
  listTagMeta,
  readTagAliasesSafe,
  updateTag,
} from '../../../../../src/features/knowledge/business/tags'
import { renameTag } from '../../../../../src/features/knowledge/business/collections'
import { createFileDriver } from '../../../../../src/features/knowledge/business/fileDriver'
import { resetDbForTest } from '../../../../../src/backend/db/client'

/**
 * Metadata tag (màu, mô tả) trên `dashboard.sqlite`.
 *
 * Điểm mới của task: tag là **thực thể**, tồn tại được khi chưa entry nào gắn
 * — trước đó nó chỉ là facet đếm tại chỗ từ front-matter.
 *
 * Cô lập: xem đầu `collections.test.ts` — cần cả `DEV_TEAM_DASHBOARD_HOME` lẫn
 * `resetDbForTest()`.
 */

let root: string
let driver: ReturnType<typeof createFileDriver>
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'kn-tags-'))
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

const facets = async () => decorateTagFacets(root, await driver.listTags())

describe('CRUD metadata tag', () => {
  test('tag CHƯA entry nào gắn vẫn tồn tại và liệt kê được với count 0 (E9)', async () => {
    expect(await createTag(root, { tag: 'chua-dung', color: 'purple', scope: 'project' } as any)).toMatchObject({
      tag: { tag: 'chua-dung', color: 'purple' },
    })
    expect(await facets()).toEqual([
      { tag: 'chua-dung', count: 0, color: 'purple', description: '', scope: 'project' },
    ])
  })

  test('trùng tên trong cùng store → 400, không đè màu cũ', async () => {
    await createTag(root, { tag: 't', color: 'blue', scope: 'project' } as any)
    expect(await createTag(root, { tag: 't', color: 'red', scope: 'project' } as any)).toMatchObject({ status: 400 })
    expect((await listTagMeta(root))[0].color).toBe('blue')
  })

  test('tên không khớp luật tag của front-matter → 400', async () => {
    expect(await createTag(root, { tag: '!!!', scope: 'project' } as any)).toMatchObject({ status: 400 })
  })

  /**
   * Phần lớn tag sinh ra từ front-matter chứ không qua dialog, nên "chọn màu
   * cho tag đang có" phải chạy được mà không bắt người dùng tạo lại tag.
   */
  test('sửa màu tag chỉ có trong front-matter thì TẠO hàng metadata, không 404', async () => {
    await driver.write({ slug: 'e', tags: ['vue'], content: 'c' })
    expect(await updateTag(root, 'vue', { color: 'green', scope: 'project' } as any)).toMatchObject({
      tag: { tag: 'vue', color: 'green' },
    })
    expect(await facets()).toEqual([
      { tag: 'vue', count: 1, color: 'green', description: '', scope: 'project' },
    ])
  })

  test('sửa một phần giữ nguyên phần còn lại', async () => {
    await createTag(root, { tag: 't', color: 'amber', description: 'mô tả', scope: 'project' } as any)
    await updateTag(root, 't', { description: 'mới', scope: 'project' } as any)
    expect((await listTagMeta(root))[0]).toMatchObject({ color: 'amber', description: 'mới' })
  })
})

describe('decorateTagFacets — gộp hai store', () => {
  test('project ĐÈ global khi trùng tên tag', async () => {
    await createTag(root, { tag: 'dung-chung', color: 'red', scope: 'global' } as any)
    await createTag(root, { tag: 'dung-chung', color: 'teal', scope: 'project' } as any)
    expect(await facets()).toEqual([
      { tag: 'dung-chung', count: 0, color: 'teal', description: '', scope: 'project' },
    ])
  })

  test('tag chỉ có ở global vẫn hiện, kèm đúng scope', async () => {
    await createTag(root, { tag: 'chi-global', color: 'pink', scope: 'global' } as any)
    expect(await facets()).toEqual([
      { tag: 'chi-global', count: 0, color: 'pink', description: '', scope: 'global' },
    ])
  })

  test('tag có entry nhưng chưa có metadata rơi về token mặc định', async () => {
    await driver.write({ slug: 'e', tags: ['khong-mau'], content: 'c' })
    expect(await facets()).toEqual([
      { tag: 'khong-mau', count: 1, color: 'slate', description: '', scope: 'project' },
    ])
  })

  /** E14 — giá trị lạ do sửa tay DB không được render thành chip mất màu. */
  test('màu lạ trong DB rơi về `slate` ở đường đọc', async () => {
    await createTag(root, { tag: 't', color: 'blue', scope: 'project' } as any)
    const { getDb } = await import('../../../../../src/backend/db/client')
    const { knowledgeTags } = await import('../../../../../src/backend/db/schema')
    ;(await getDb()).update(knowledgeTags).set({ color: 'neon-cam' }).run()
    expect((await facets())[0].color).toBe('slate')
  })

  /**
   * E1 — DB hỏng chỉ được làm mất phần màu; danh sách knowledge đọc từ file
   * nên 🚫 không được chết theo. Mô phỏng bằng cách trỏ registry home vào một
   * **file** (mkdir thất bại ⇒ `getDb()` ném).
   */
  test('DB không mở được: facet vẫn trả, chỉ mất metadata', async () => {
    await driver.write({ slug: 'e', tags: ['x'], content: 'c' })
    const blocker = path.join(root, 'blocker')
    await fs.writeFile(blocker, 'not a dir')
    process.env.DEV_TEAM_DASHBOARD_HOME = path.join(blocker, 'home')
    resetDbForTest()

    expect(await facets()).toEqual([
      { tag: 'x', count: 1, color: 'slate', description: '', scope: 'project' },
    ])
    expect(await readTagAliasesSafe(root)).toEqual({})
    expect(await driver.list()).toHaveLength(1)
  })
})

describe('đổi tên tag dời metadata (TC-41b)', () => {
  /**
   * `decorateTagFacets` cố ý liệt kê mọi tag chỉ-có-trong-DB, nên một hàng
   * mang tên **cũ** còn sót lại sẽ hiện vĩnh viễn với `count: 0` — mà xoá tag
   * nằm ngoài phạm vi, người dùng không có cách nào gỡ.
   */
  test('sau khi đổi tên, tên CŨ biến mất khỏi danh sách và màu theo sang tên mới', async () => {
    await driver.write({ slug: 'e', tags: ['alpha'], content: 'c' })
    await createTag(root, { tag: 'alpha', color: 'purple', scope: 'project' } as any)

    await renameTag(root, { from: 'alpha', to: 'beta' })

    expect(await facets()).toEqual([
      { tag: 'beta', count: 1, color: 'purple', description: '', scope: 'project' },
    ])
    // Alias sống: lọc theo tên cũ vẫn ra đúng entry.
    expect((await driver.list({ tags: ['alpha'] })).map((e) => e.id)).toEqual(['project/e'])
  })

  test('merge vào tag đã có metadata thì GIỮ màu của tag đích, không đẻ hàng thừa', async () => {
    await driver.write({ slug: 'e', tags: ['alpha'], content: 'c' })
    await createTag(root, { tag: 'alpha', color: 'purple', scope: 'project' } as any)
    await createTag(root, { tag: 'beta', color: 'green', scope: 'project' } as any)

    await renameTag(root, { from: 'alpha', to: 'beta' })

    expect(await facets()).toEqual([
      { tag: 'beta', count: 1, color: 'green', description: '', scope: 'project' },
    ])
  })

  test('xoá tag (`to` rỗng) gỡ luôn metadata', async () => {
    await driver.write({ slug: 'e', tags: ['gone'], content: 'c' })
    await createTag(root, { tag: 'gone', color: 'red', scope: 'project' } as any)

    await renameTag(root, { from: 'gone' })

    expect(await facets()).toEqual([])
    expect(await listTagMeta(root)).toEqual([])
  })
})
