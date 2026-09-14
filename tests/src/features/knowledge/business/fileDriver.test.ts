import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createFileDriver, knowledgeRoot, loadKnowledgeBundle } from '../../../../../src/features/knowledge/business/fileDriver'
import { resetDbForTest } from '../../../../../src/backend/db/client'
import { MAX_BUNDLE_BYTES } from '../../../../../src/features/knowledge/schemas/knowledge'

let root: string
let home: string
let driver: ReturnType<typeof createFileDriver>
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
  // Driver đụng DB qua alias tag / lọc theo nhóm — reset để không dùng lại
  // connection trỏ home của test trước (getDb cache theo process).
  resetDbForTest()
  driver = createFileDriver(root)
})
afterEach(async () => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  await fs.rm(root, { recursive: true, force: true })
})

describe('write + read round-trip', () => {
  test('persists frontmatter + content and reads it back', async () => {
    const w = await driver.write({ title: 'My Note', slug: 'my-note', scope: 'project', tags: ['a', 'b'], content: 'hello' })
    expect(w.id).toBe('project/my-note')
    const r = await driver.read('project/my-note')
    expect(r.title).toBe('My Note')
    expect(r.scope).toBe('project')
    expect(r.tags).toEqual(['a', 'b'])
    expect(r.content.trim()).toBe('hello')
  })
  test('file lands under knowledge/<scope>/<slug>.md', async () => {
    await driver.write({ slug: 'x', scope: 'system', content: 'c' })
    const fp = path.join(knowledgeRoot(root), 'system', 'x.md')
    expect((await fs.readFile(fp, 'utf8')).startsWith('---')).toBe(true)
  })
  test('rejects an invalid scope', async () => {
    await expect(driver.write({ slug: 'y', scope: 'bogus' as any, content: 'c' })).rejects.toThrow('invalid scope')
  })
})

describe('list', () => {
  beforeEach(async () => {
    await driver.write({ slug: 'alpha', scope: 'project', tags: ['x'], content: 'find-me' })
    await driver.write({ slug: 'beta', scope: 'system', tags: ['y'], content: 'other' })
  })
  test('returns metadata without content', async () => {
    const all = await driver.list()
    expect(all).toHaveLength(2)
    expect((all[0] as any).content).toBeUndefined()
  })
  test('filters by scope, tags, query', async () => {
    expect(await driver.list({ scope: 'system' })).toHaveLength(1)
    expect(await driver.list({ tags: ['x'] })).toHaveLength(1)
    const q = await driver.list({ query: 'find-me' })
    expect(q).toHaveLength(1)
    expect(q[0].slug).toBe('alpha')
  })
})

describe('listTags / delete', () => {
  test('counts tags then removes an entry', async () => {
    await driver.write({ slug: 'a', tags: ['t1', 't2'], content: 'c' })
    await driver.write({ slug: 'b', tags: ['t1'], content: 'c' })
    const tags = await driver.listTags()
    expect(tags).toEqual([{ tag: 't1', count: 2 }, { tag: 't2', count: 1 }])
    expect(await driver.delete('project/a')).toEqual({ deleted: true, id: 'project/a' })
    expect(await driver.list()).toHaveLength(1)
  })
})

describe('upload', () => {
  test('parses frontmatter from an uploaded .md', async () => {
    const md = '---\ntitle: Up\ntags: [u1]\n---\nbody text'
    const entry = await driver.upload({ filename: 'up.md', content: md, scope: 'project' })
    expect(entry.title).toBe('Up')
    expect(entry.tags).toEqual(['u1'])
    expect(entry.content.trim()).toBe('body text')
  })
  test('rejects duplicate, oversized, and bad-extension uploads', async () => {
    await driver.upload({ filename: 'dup.txt', content: 'x', scope: 'project' })
    await expect(driver.upload({ filename: 'dup.txt', content: 'x', scope: 'project' })).rejects.toThrow('already exists')
    await expect(driver.upload({ filename: 'big.md', content: 'a'.repeat(512 * 1024 + 1), scope: 'project' })).rejects.toThrow('too large')
    await expect(driver.upload({ filename: 'bad.pdf', content: 'x', scope: 'project' })).rejects.toThrow('only .md and .txt')
  })
})

describe('loadKnowledgeBundle', () => {
  test('returns content for found ids and error for missing', async () => {
    await driver.write({ slug: 'k', scope: 'project', content: 'kc' })
    const bundle = await loadKnowledgeBundle(root, ['project/k', 'project/missing'])
    expect(bundle[0]).toMatchObject({ id: 'project/k' })
    expect(bundle[0].content.trim()).toBe('kc')
    expect(bundle[1]).toMatchObject({ id: 'project/missing', error: 'not found' })
  })
  test('empty ids → []', async () => {
    expect(await loadKnowledgeBundle(root, [])).toEqual([])
  })
})

describe('scope global — đa root', () => {
  test('entry global nằm ở registry home, không dưới project (TC-G1)', async () => {
    const entry = await driver.write({ slug: 'shared', scope: 'global', content: 'g' })
    expect(entry.id).toBe('global/shared')
    expect(await fs.readFile(path.join(home, 'knowledge', 'global', 'shared.md'), 'utf8')).toContain('g')
    expect(entry.path.startsWith(knowledgeRoot(root))).toBe(false)
  })

  test('project khác cùng home đọc được entry global, không thấy entry project (TC-G2 · TC-G3)', async () => {
    await driver.write({ slug: 'shared', scope: 'global', content: 'g' })
    await driver.write({ slug: 'mine', scope: 'project', content: 'p' })

    const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kn-other-'))
    try {
      const ids = (await createFileDriver(otherRoot).list()).map((e) => e.id)
      expect(ids).toEqual(['global/shared'])
    } finally {
      await fs.rm(otherRoot, { recursive: true, force: true })
    }
  })

  test('trùng slug khác scope là hai file độc lập (TC-G9)', async () => {
    await driver.write({ slug: 'x', scope: 'project', content: 'p' })
    await driver.write({ slug: 'x', scope: 'global', content: 'g' })
    await driver.write({ id: 'global/x', slug: 'x', scope: 'global', content: 'g2' })

    expect((await driver.read('project/x')).content.trim()).toBe('p')
    expect((await driver.read('global/x')).content.trim()).toBe('g2')
  })

  test('scope lạ trả rỗng và KHÔNG đẻ thư mục (TC-G7)', async () => {
    await driver.write({ slug: 'a', content: 'c' })
    expect(await driver.list({ scope: 'Global' })).toEqual([])
    expect(await fs.readdir(knowledgeRoot(root))).not.toContain('Global')
  })

  test('chỉ đọc thì không tạo thư mục nào trên đĩa (TC-G10)', async () => {
    expect(await driver.list()).toEqual([])
    expect(await driver.listTags()).toEqual([])
    await expect(fs.stat(home)).rejects.toThrow()
    await expect(fs.stat(knowledgeRoot(root))).rejects.toThrow()
  })
})

describe('front-matter khoá lạ (TC-G13)', () => {
  test('round-trip giữ nguyên khoá API không biết', async () => {
    await driver.write({ slug: 'e', tags: ['a'], content: 'body' })
    const file = path.join(knowledgeRoot(root), 'project', 'e.md')
    await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('---\n\nbody', 'owner: tuan\nweight: 3\n---\n\nbody'))

    await driver.write({ id: 'project/e', slug: 'e', tags: ['a', 'b'], content: 'body 2' })

    const raw = await fs.readFile(file, 'utf8')
    expect(raw).toContain('owner: tuan')
    expect(raw).toContain('weight: 3')
    expect((await driver.read('project/e')).tags).toEqual(['a', 'b'])
  })
})

describe('cap byte của bundle (TC-I7)', () => {
  test('entry to bị từ chối KHÔNG làm hỏng entry đứng sau nó', async () => {
    await driver.write({ slug: 'small-1', content: 'a'.repeat(1000) })
    await driver.write({ slug: 'huge', content: 'b'.repeat(MAX_BUNDLE_BYTES) })
    await driver.write({ slug: 'small-2', content: 'c'.repeat(1000) })

    const bundle = await loadKnowledgeBundle(root, ['project/small-1', 'project/huge', 'project/small-2'])

    expect(bundle[0].content).toBeDefined()
    expect(bundle[1]).toEqual({ id: 'project/huge', error: 'bundle size limit' })
    // Byte của entry bị từ chối không được tính vào tổng.
    expect(bundle[2].content).toBeDefined()
  })
})

/**
 * Slug là phần **nội suy**: dialog không còn ô nhập, driver tự sinh từ title và
 * tự chống trùng. Ba bất biến ở đây, cả ba từng hỏng theo cách im lặng:
 * đọc được (G1) · không ghi đè (G2) · client không lái được slug khi sửa (G3).
 */
describe('nội suy slug khi tạo mới', () => {
  /** Tên file trên đĩa và `slug` trong front-matter phải là **một** giá trị. */
  async function slugOnDisk(id: string): Promise<{ file: string; fm: string }> {
    const file = id.split('/')[1]
    const raw = await fs.readFile(path.join(knowledgeRoot(root), 'project', `${file}.md`), 'utf8')
    return { file, fm: /^slug: (.*)$/m.exec(raw)?.[1] ?? '' }
  }

  test('title tiếng Việt ra slug ĐỌC ĐƯỢC, không bị băm theo dấu (G1)', async () => {
    const w = await driver.write({ title: 'Kiến trúc hệ thống', content: 'c' })
    expect(w.id).toBe('project/kien-truc-he-thong')
  })

  test('trùng title sinh hậu tố chứ KHÔNG ghi đè entry cũ (G2 · E4)', async () => {
    const a = await driver.write({ title: 'Ghi chú', content: 'bản 1' })
    const b = await driver.write({ title: 'Ghi chú', content: 'bản 2' })

    expect(a.id).toBe('project/ghi-chu')
    expect(b.id).toMatch(/^project\/ghi-chu-[0-9a-f]{4}$/)
    expect((await driver.read(a.id)).content.trim()).toBe('bản 1')
    expect(await driver.list()).toHaveLength(2)
  })

  test('front-matter `slug` khớp tên file ở cả entry gốc lẫn entry có hậu tố', async () => {
    const a = await driver.write({ title: 'Ghi chú', content: 'c' })
    const b = await driver.write({ title: 'Ghi chú', content: 'c' })
    for (const id of [a.id, b.id]) {
      const { file, fm } = await slugOnDisk(id)
      expect(fm).toBe(file)
    }
  })

  /**
   * TC-46b — hậu tố phải nằm **lọt** trong trần 80 ký tự của `sanitiseSlug`.
   * Ghép hậu tố vào seed đã sát trần thì `entryPath` cắt lại: entry thứ hai
   * hoặc mang front-matter lệch tên file, hoặc không tạo được vì mọi ứng viên
   * bị cắt về đúng seed cũ.
   */
  test('title 80 ký tự vẫn tạo được entry thứ hai, slug khớp tên file (TC-46b)', async () => {
    const long = 'a'.repeat(80)
    const a = await driver.write({ title: long, content: '1' })
    const b = await driver.write({ title: long, content: '2' })

    expect(b.id).not.toBe(a.id)
    for (const id of [a.id, b.id]) {
      const { file, fm } = await slugOnDisk(id)
      expect(file.length).toBeLessThanOrEqual(80)
      expect(fm).toBe(file)
    }
  })

  test('title toàn ký tự không ASCII rơi về `entry`, không ném invalid slug (E5)', async () => {
    expect((await driver.write({ title: '日本語', content: 'c' })).id).toBe('project/entry')
  })

  test('SỬA entry thì bỏ qua `slug` client gửi — slug lấy từ id (G3)', async () => {
    const a = await driver.write({ title: 'Gốc', content: 'c' })
    const again = await driver.write({ id: a.id, title: 'Đổi title', slug: 'client-tu-dat', content: 'c2' })

    expect(again.id).toBe(a.id)
    expect(await driver.list()).toHaveLength(1)
    const { file, fm } = await slugOnDisk(a.id)
    expect(fm).toBe(file)
  })

  /** `upload()` gọi `write({ id })` nên phải rơi vào nhánh **sửa**, giữ guard riêng của nó. */
  test('upload trùng tên file vẫn báo lỗi thay vì âm thầm sinh hậu tố', async () => {
    await driver.upload({ filename: 'note.md', content: 'a', scope: 'project' })
    expect(driver.upload({ filename: 'note.md', content: 'b', scope: 'project' })).rejects.toThrow(
      /already exists/,
    )
  })
})
