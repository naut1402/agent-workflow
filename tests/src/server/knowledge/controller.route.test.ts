import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createApp } from '../../../../src/backend/apiServer.js'
import type { RegistryContext } from '../../../../src/backend/http/types.js'
import { on, _resetEventBusForTest } from '../../../../src/backend/events/index.js'
import type { DashboardEvent } from '../../../../src/backend/events/index.js'

/**
 * Bề mặt HTTP của knowledge sau khi migrate sang Hono — thay cho
 * `business/knowledgeApi.test.ts` (dispatch node-res đã bị xoá). Mọi assertion
 * của bản cũ được bê nguyên sang: POST 201 → GET list → GET by id → DELETE,
 * upload multipart, JSON hỏng → 400, id lạ → 404.
 *
 * Dựng theo khuôn `tests/src/server/automations/controller.route.test.ts`: tmp
 * root + `DEV_TEAM_DASHBOARD_HOME` cô lập. Cô lập home là **bắt buộc** ở đây —
 * scope `global` đọc thẳng registry home, không cô lập thì suite ăn knowledge
 * thật của máy đang chạy.
 */

const PROJECT_ID = 'proj-knowledge'
/** Project thứ hai, cùng home → dùng để chứng minh global dùng chung. */
const OTHER_PROJECT_ID = 'proj-other'

let root: string
let otherRoot: string
let home: string
let app: Awaited<ReturnType<typeof createApp>>
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

function fakeCtx(): RegistryContext {
  return {
    defaultRoot: root,
    resolveProjectRoot: (id: string | null) => (id === OTHER_PROJECT_ID ? otherRoot : root),
    registry: {
      list: () => ({ projects: [], defaultId: null }),
      get: () => null,
      add: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      remove: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      validateProjectPath: (() => ({ ok: false, status: 400, error: 'stub' })) as any,
      seedDefault: () => null,
    },
  }
}

function url(pathname: string, project = PROJECT_ID): string {
  return `${pathname}${pathname.includes('?') ? '&' : '?'}project=${project}`
}

function jsonReq(method: string, pathname: string, body?: unknown, project = PROJECT_ID) {
  return app.request(url(pathname, project), {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

let events: DashboardEvent[] = []
function captureEntityEvents(): void {
  for (const type of ['entity.created', 'entity.updated', 'entity.deleted'] as const) {
    on(type, (e) => {
      events.push(e)
    })
  }
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-knowledge-api-'))
  otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-knowledge-other-'))
  home = path.join(root, '.home')
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  fs.mkdirSync(home, { recursive: true })
  app = await createApp(fakeCtx())
})

afterAll(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(otherRoot, { recursive: true, force: true })
})

beforeEach(() => {
  for (const dir of [path.join(root, 'knowledge'), path.join(otherRoot, 'knowledge'), path.join(home, 'knowledge')]) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
  _resetEventBusForTest()
  events = []
  captureEntityEvents()
})

afterEach(() => {
  _resetEventBusForTest()
})

const create = (body: Record<string, unknown>, project = PROJECT_ID) =>
  jsonReq('POST', '/api/knowledge', body, project)

describe('knowledge entry CRUD qua Hono', () => {
  test('POST ghi, GET liệt kê + đọc theo id, DELETE xoá', async () => {
    const posted = await create({ slug: 'note1', scope: 'project', tags: ['t'], content: 'hi' })
    expect(posted.status).toBe(201)
    expect((await posted.json()).entry.id).toBe('project/note1')

    const listed = await app.request(url('/api/knowledge'))
    expect(listed.status).toBe(200)
    expect((await listed.json()).entries).toHaveLength(1)

    const read = await app.request(url('/api/knowledge?id=project/note1'))
    expect((await read.json()).entry.content.trim()).toBe('hi')

    const missing = await app.request(url('/api/knowledge?id=project/nope'))
    expect(missing.status).toBe(404)

    const removed = await jsonReq('DELETE', '/api/knowledge?id=project/note1')
    expect((await removed.json()).deleted).toBe(true)
  })

  test('CRUD phát đúng entity.knowledge', async () => {
    await create({ slug: 'ev', content: 'c' })
    expect(events.map((e) => e.type)).toEqual(['entity.created'])
    expect(events[0].payload).toMatchObject({ entity: 'knowledge', id: 'project/ev', projectId: PROJECT_ID })

    events = []
    await jsonReq('PUT', '/api/knowledge?id=project/ev', { slug: 'ev', content: 'c2' })
    await jsonReq('DELETE', '/api/knowledge?id=project/ev')
    expect(events.map((e) => e.type)).toEqual(['entity.updated', 'entity.deleted'])
  })

  test('GET /tags đếm tag; body JSON hỏng → 400; method lạ → 405', async () => {
    await create({ slug: 'a', tags: ['x'], content: 'c' })
    const tags = await app.request(url('/api/knowledge/tags'))
    expect((await tags.json()).tags).toEqual([{ tag: 'x', count: 1 }])

    const bad = await app.request(url('/api/knowledge'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad',
    })
    expect(bad.status).toBe(400)

    const patched = await app.request(url('/api/knowledge'), { method: 'PATCH' })
    expect(patched.status).toBe(405)
  })

  test('upload multipart tạo entry và giữ title có dấu (TC-G14)', async () => {
    const form = new FormData()
    form.append('file', new File(['nội dung'], 'Quy ước ghi log.md', { type: 'text/markdown' }))
    form.append('scope', 'project')
    const res = await app.request(url('/api/knowledge/upload'), { method: 'POST', body: form })

    expect(res.status).toBe(201)
    const { entry } = await res.json()
    expect(entry.title).toBe('Quy ước ghi log')
    expect(entry.id).toBe('project/quy-c-ghi-log')
  })

  test('include=tags trả entry + facet trong MỘT request (G5)', async () => {
    await create({ slug: 'a', tags: ['x'], content: 'c' })
    const res = await app.request(url('/api/knowledge?include=tags'))
    const body = await res.json()
    expect(body.entries).toHaveLength(1)
    expect(body.tags).toEqual([{ tag: 'x', count: 1 }])
  })
})

describe('scope global (TC-G1 · TC-G2 · TC-G3 · TC-G7 · TC-G8 · TC-G10)', () => {
  test('entry global tạo ở project A đọc được từ project B, entry project thì không', async () => {
    expect((await create({ slug: 'shared', scope: 'global', content: 'g' })).status).toBe(201)
    await create({ slug: 'mine', scope: 'project', content: 'p' })

    const fromB = await app.request(url('/api/knowledge', OTHER_PROJECT_ID))
    const ids = (await fromB.json()).entries.map((e: { id: string }) => e.id)
    expect(ids).toContain('global/shared')
    expect(ids).not.toContain('project/mine')

    const readFromB = await app.request(url('/api/knowledge?id=global/shared', OTHER_PROJECT_ID))
    expect((await readFromB.json()).entry.content.trim()).toBe('g')
  })

  test('không truyền scope trả gộp cả ba, không id trùng (TC-G5)', async () => {
    await create({ slug: 'p', scope: 'project', content: 'c' })
    await create({ slug: 's', scope: 'system', content: 'c' })
    await create({ slug: 'g', scope: 'global', content: 'c' })

    const ids = (await (await app.request(url('/api/knowledge'))).json()).entries.map((e: { id: string }) => e.id)
    expect(ids.sort()).toEqual(['global/g', 'project/p', 'system/s'])
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('scope sai hoa-thường → 400, không tạo store mới (TC-G7)', async () => {
    const res = await app.request(url('/api/knowledge?scope=Global'))
    expect(res.status).toBe(400)
    expect(fs.existsSync(path.join(root, 'knowledge', 'Global'))).toBe(false)
  })

  test('id thoát thư mục không đọc được file ngoài store (TC-G8)', async () => {
    for (const id of ['global/../../../etc/passwd', '../project/x', 'global/..%2Fx']) {
      const res = await app.request(url(`/api/knowledge?id=${encodeURIComponent(id)}`))
      expect(res.status).toBe(404)
    }
  })

  test('chỉ đọc thì KHÔNG tạo thư mục nào trên đĩa (TC-G10)', async () => {
    const res = await app.request(url('/api/knowledge'))
    expect(res.status).toBe(200)
    expect((await res.json()).entries).toEqual([])
    // Store global chưa từng tồn tại: liệt kê không được đẻ rác trong home.
    expect(fs.existsSync(path.join(home, 'knowledge'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'knowledge'))).toBe(false)
  })
})

describe('collection + tag admin (nhóm T)', () => {
  const createCollection = (body: Record<string, unknown>) =>
    jsonReq('POST', '/api/knowledge/collections', body)

  test('collection rỗng vẫn tồn tại; xoá nhóm không xoá entry (TC-T8 · TC-T13)', async () => {
    expect((await createCollection({ name: 'Nhóm A', scope: 'project' })).status).toBe(201)
    const listed = await (await app.request(url('/api/knowledge/collections'))).json()
    expect(listed.collections).toHaveLength(1)
    expect(listed.collections[0]).toMatchObject({ id: 'nh-m-a', entryCount: 0, scope: 'project' })

    await create({ slug: 'keep', tags: ['grp'], content: 'c' })
    await jsonReq('PUT', '/api/knowledge/collections/nh-m-a', { name: 'Nhóm A', tags: ['grp'] })
    expect((await jsonReq('DELETE', '/api/knowledge/collections/nh-m-a')).status).toBe(200)

    const entries = (await (await app.request(url('/api/knowledge'))).json()).entries
    expect(entries.map((e: { id: string }) => e.id)).toEqual(['project/keep'])
  })

  test('CRUD collection phát entity.knowledge-collection (TC-R10)', async () => {
    await createCollection({ name: 'Ev', scope: 'project' })
    await jsonReq('PUT', '/api/knowledge/collections/ev', { name: 'Ev 2' })
    await jsonReq('DELETE', '/api/knowledge/collections/ev')

    expect(events.map((e) => e.type)).toEqual(['entity.created', 'entity.updated', 'entity.deleted'])
    for (const e of events) expect(e.payload).toMatchObject({ entity: 'knowledge-collection', id: 'ev' })
  })

  test('đổi scope của collection có sẵn bị từ chối, không im lặng bỏ qua', async () => {
    await createCollection({ name: 'Sc', scope: 'project' })
    const res = await jsonReq('PUT', '/api/knowledge/collections/sc', { name: 'Sc', scope: 'global' })
    expect(res.status).toBe(400)
  })

  test('lọc theo tên tag CŨ vẫn ra kết quả sau rename (TC-T1 · TC-T2)', async () => {
    await create({ slug: 'e1', tags: ['a'], content: 'c' })
    await create({ slug: 'e2', tags: ['a', 'z'], content: 'c' })
    await create({ slug: 'e3', tags: ['z'], content: 'c' })

    const renamed = await jsonReq('POST', '/api/knowledge/tags/rename', { from: 'a', to: 'b' })
    expect((await renamed.json()).renamed).toBe(2)

    const byNew = await (await app.request(url('/api/knowledge?tags=b'))).json()
    expect(byNew.entries.map((e: { id: string }) => e.id).sort()).toEqual(['project/e1', 'project/e2'])

    // Alias: đường dẫn/bookmark cũ không được chết sau một lần rename.
    const byOld = await (await app.request(url('/api/knowledge?tags=a'))).json()
    expect(byOld.entries.map((e: { id: string }) => e.id).sort()).toEqual(['project/e1', 'project/e2'])
  })

  test('merge vào tag đã có không nhân đôi (TC-T3)', async () => {
    await create({ slug: 'x', tags: ['a', 'b'], content: 'c' })
    await jsonReq('POST', '/api/knowledge/tags/rename', { from: 'a', to: 'b' })

    const entry = (await (await app.request(url('/api/knowledge?id=project/x'))).json()).entry
    expect(entry.tags).toEqual(['b'])
    const tags = (await (await app.request(url('/api/knowledge/tags'))).json()).tags
    expect(tags).toEqual([{ tag: 'b', count: 1 }])
  })

  test('rename với tên chuẩn hoá thành rỗng → 400, không entry nào bị sửa (TC-T4)', async () => {
    await create({ slug: 'safe', tags: ['a'], content: 'c' })
    const before = fs.readFileSync(path.join(root, 'knowledge', 'project', 'safe.md'), 'utf8')

    expect((await jsonReq('POST', '/api/knowledge/tags/rename', { from: '   ' })).status).toBe(400)
    expect((await jsonReq('POST', '/api/knowledge/tags/rename', { from: 'a', to: '!!!' })).status).toBe(400)

    expect(fs.readFileSync(path.join(root, 'knowledge', 'project', 'safe.md'), 'utf8')).toBe(before)
  })

  test('sidecar hỏng: entry vẫn liệt kê, phần collection báo lỗi rõ (TC-T15)', async () => {
    await create({ slug: 'alive', content: 'c' })
    fs.writeFileSync(path.join(root, 'knowledge', 'collections.yaml'), 'collections: [\n  broken: : :\n')

    const entries = await app.request(url('/api/knowledge'))
    expect(entries.status).toBe(200)
    expect((await entries.json()).entries).toHaveLength(1)

    const collections = await app.request(url('/api/knowledge/collections'))
    expect(collections.status).toBe(500)
    expect((await collections.json()).error).toContain('collections.yaml')
  })

  test('sidecar hỏng thì đường GHI bị chặn, không đè mất dữ liệu cũ', async () => {
    const file = path.join(root, 'knowledge', 'collections.yaml')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const corrupt = 'collections: [\n  broken: : :\n'
    fs.writeFileSync(file, corrupt)

    expect((await jsonReq('POST', '/api/knowledge/collections', { name: 'Mới' })).status).toBe(500)
    expect(fs.readFileSync(file, 'utf8')).toBe(corrupt)
  })
})

describe('bundle (nhóm I)', () => {
  test('trả nội dung + path, id lạ nêu đích danh, không làm vỡ cả bundle (TC-I1 · TC-I3)', async () => {
    await create({ slug: 'k', content: 'kc' })
    const res = await app.request(url('/api/knowledge/bundle?ids=project/k,project/missing'))

    const { bundle } = await res.json()
    expect(bundle[0]).toMatchObject({ id: 'project/k' })
    expect(bundle[0].content.trim()).toBe('kc')
    expect(bundle[0].path).toContain('project/k.md')
    expect(bundle[1]).toEqual({ id: 'project/missing', error: 'not found' })
  })

  test('id lặp gộp lại; quá ngưỡng thì TỪ CHỐI chứ không cắt im lặng (TC-I6 · TC-I7)', async () => {
    await create({ slug: 'k', content: 'kc' })
    const dup = await (await app.request(url('/api/knowledge/bundle?ids=project/k,project/k'))).json()
    expect(dup.bundle).toHaveLength(1)

    const many = Array.from({ length: 51 }, (_, i) => `project/k${i}`).join(',')
    const res = await app.request(url(`/api/knowledge/bundle?ids=${many}`))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('max 50')
  })

  test('bundle gộp cả ba scope trong một lượt (TC-I2)', async () => {
    await create({ slug: 'p', scope: 'project', content: 'a' })
    await create({ slug: 's', scope: 'system', content: 'b' })
    await create({ slug: 'g', scope: 'global', content: 'c' })

    const { bundle } = await (
      await app.request(url('/api/knowledge/bundle?ids=project/p,system/s,global/g'))
    ).json()
    expect(bundle.map((b: { content?: string }) => b.content?.trim())).toEqual(['a', 'b', 'c'])
  })
})
