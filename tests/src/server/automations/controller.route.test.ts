import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/api/apiServer.js'
import type { RegistryContext } from '../../../../src/core/http/types.js'
import { on, _resetEventBusForTest } from '../../../../src/core/events/index.js'
import type { DashboardEvent } from '../../../../src/core/events/index.js'

/**
 * TC-14 (nợ roadmap 1.1.0 §5): CRUD qua HTTP phát đúng `entity.*`.
 *
 * Bất biến event kernel (docs/event-catalog.md) được phủ ở đây:
 *  (i)   emit **sau** khi persist thành công — listener đọc lại file rule thấy
 *        ngay dữ liệu mới / thấy file đã mất;
 *  (ii)  payload tối thiểu: `entity` + `id` + `projectId` (toggle thêm `detail`);
 *  (iii) subscriber ném lỗi không làm hỏng request;
 *  (iv)  mutation thất bại (400/404) thì không phát event nào.
 *
 * Dựng theo khuôn `tests/src/server/http/connections.route.test.ts`: tmp root +
 * `DEV_TEAM_DASHBOARD_HOME` cô lập để không đụng registry thật của máy.
 */

const PROJECT_ID = 'proj-automations'

let root: string
let home: string
let app: Awaited<ReturnType<typeof createApp>>
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

function fakeCtx(): RegistryContext {
  return {
    defaultRoot: root,
    // Cả `?project=` và không truyền đều resolve về cùng tmp root — test chỉ
    // cần projectId có mặt trong payload, không cần registry thật.
    resolveProjectRoot: () => root,
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

const validRule = {
  name: 'Rule A',
  enabled: true,
  triggers: [{ kind: 'timer', startAt: '2026-01-01T00:00:00.000Z', repeat: { mode: 'once' } }],
  actions: [{ kind: 'runTask', mode: 'create', prompt: 'làm việc' }],
}
/** `createAutomation` slug hoá tên → id ổn định, không cần đọc lại body. */
const RULE_ID = 'rule-a'

function url(pathname: string): string {
  return `${pathname}${pathname.includes('?') ? '&' : '?'}project=${PROJECT_ID}`
}

function ruleFile(id: string): string {
  return path.join(root, 'automations', `${id}.yaml`)
}

function jsonReq(method: string, pathname: string, body?: unknown) {
  return app.request(url(pathname), {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

/** Mọi `entity.*` phát ra trong lúc chạy case, theo thứ tự. */
let events: DashboardEvent[] = []

function captureEntityEvents(): void {
  for (const type of ['entity.created', 'entity.updated', 'entity.deleted'] as const) {
    on(type, (e) => {
      events.push(e)
    })
  }
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-automations-api-'))
  home = path.join(root, '.home')
  process.env.DEV_TEAM_DASHBOARD_HOME = home
  fs.mkdirSync(home, { recursive: true })
  app = await createApp(fakeCtx())
})

afterAll(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  fs.rmSync(path.join(root, 'automations'), { recursive: true, force: true })
  _resetEventBusForTest()
  events = []
  captureEntityEvents()
})

afterEach(() => {
  _resetEventBusForTest()
})

async function seedRule(): Promise<void> {
  const res = await jsonReq('POST', '/api/automations', validRule)
  expect(res.status).toBe(201)
  events = []
}

describe('automations CRUD API — entity.* events', () => {
  test('POST /api/automations → 201 + entity.created (payload tối thiểu)', async () => {
    const res = await jsonReq('POST', '/api/automations', validRule)

    expect(res.status).toBe(201)
    expect((await res.json()).automation.id).toBe(RULE_ID)
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('entity.created')
    expect(events[0].payload).toEqual({ entity: 'automation', id: RULE_ID, projectId: PROJECT_ID })
  })

  test('PUT /api/automations/:id → entity.updated', async () => {
    await seedRule()

    const res = await jsonReq('PUT', `/api/automations/${RULE_ID}`, { ...validRule, name: 'Rule A đổi tên' })

    expect(res.status).toBe(200)
    expect((await res.json()).automation.name).toBe('Rule A đổi tên')
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('entity.updated')
    expect(events[0].payload).toEqual({ entity: 'automation', id: RULE_ID, projectId: PROJECT_ID })
  })

  test('POST /api/automations/:id/toggle → entity.updated kèm detail.enabled', async () => {
    await seedRule()

    const res = await jsonReq('POST', `/api/automations/${RULE_ID}/toggle`, { enabled: false })

    expect(res.status).toBe(200)
    expect((await res.json()).automation.enabled).toBe(false)
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('entity.updated')
    expect(events[0].payload).toEqual({
      entity: 'automation',
      id: RULE_ID,
      projectId: PROJECT_ID,
      detail: { enabled: false },
    })
  })

  test('DELETE /api/automations/:id → entity.deleted', async () => {
    await seedRule()

    const res = await jsonReq('DELETE', `/api/automations/${RULE_ID}`)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: RULE_ID, deleted: true })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('entity.deleted')
    expect(events[0].payload).toEqual({ entity: 'automation', id: RULE_ID, projectId: PROJECT_ID })
  })
})

describe('automations CRUD API — emit chỉ sau khi persist', () => {
  test('listener của entity.created đọc lại file rule đã thấy dữ liệu mới', async () => {
    let onDisk: string | null = null
    on('entity.created', () => {
      // Đọc sync — `emit` không await handler, nên đây là đúng thời điểm phát.
      onDisk = fs.existsSync(ruleFile(RULE_ID)) ? fs.readFileSync(ruleFile(RULE_ID), 'utf8') : null
    })

    await jsonReq('POST', '/api/automations', validRule)

    expect(onDisk).toContain('id: rule-a')
    expect(onDisk).toContain('Rule A')
  })

  test('listener của entity.deleted đọc lại thì file rule đã mất', async () => {
    await seedRule()
    let stillThere: boolean | null = null
    on('entity.deleted', () => {
      stillThere = fs.existsSync(ruleFile(RULE_ID))
    })

    await jsonReq('DELETE', `/api/automations/${RULE_ID}`)

    expect(stillThere).toBe(false)
  })
})

describe('automations CRUD API — mutation thất bại không phát event', () => {
  test('POST body sai schema → 400, không emit, không tạo file', async () => {
    const res = await jsonReq('POST', '/api/automations', { name: '' })

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid request')
    expect(events).toEqual([])
    expect(fs.existsSync(ruleFile(RULE_ID))).toBe(false)
  })

  test('POST cron sai cú pháp → 400, không emit', async () => {
    const res = await jsonReq('POST', '/api/automations', {
      ...validRule,
      triggers: [{ kind: 'timer', startAt: '2026-01-01T00:00:00.000Z', repeat: { mode: 'cron', expr: '99 99 * * *' } }],
    })

    expect(res.status).toBe(400)
    expect(events).toEqual([])
  })

  test('POST body không phải JSON → 400, không emit', async () => {
    const res = await app.request(url('/api/automations'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'không-phải-json',
    })

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid JSON body')
    expect(events).toEqual([])
  })

  test('id không khớp AUTOMATION_ID_PATTERN → 400, không emit', async () => {
    for (const res of [
      await jsonReq('PUT', '/api/automations/Not_Valid', validRule),
      await jsonReq('POST', '/api/automations/Not_Valid/toggle', { enabled: false }),
      await jsonReq('DELETE', '/api/automations/Not_Valid'),
    ]) {
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('invalid automation id')
    }
    expect(events).toEqual([])
  })

  test('id hợp lệ nhưng rule không tồn tại → 404, không emit', async () => {
    for (const res of [
      await jsonReq('PUT', '/api/automations/missing-rule', validRule),
      await jsonReq('POST', '/api/automations/missing-rule/toggle', { enabled: false }),
      await jsonReq('DELETE', '/api/automations/missing-rule'),
    ]) {
      expect(res.status).toBe(404)
      expect((await res.json()).error).toBe('automation not found')
    }
    expect(events).toEqual([])
  })

  test('update rule đã bị xoá → 404, không emit', async () => {
    await seedRule()
    await jsonReq('DELETE', `/api/automations/${RULE_ID}`)
    events = []

    const res = await jsonReq('PUT', `/api/automations/${RULE_ID}`, validRule)

    expect(res.status).toBe(404)
    expect(events).toEqual([])
  })
})

describe('automations CRUD API — subscriber lỗi không làm hỏng thao tác', () => {
  test('listener ném lỗi: request vẫn 201, rule vẫn được ghi, listener khác vẫn nhận', async () => {
    const others: string[] = []
    on('entity.created', () => {
      throw new Error('subscriber nổ')
    })
    on('entity.created', (e) => {
      others.push(String(e.payload.id))
    })

    const res = await jsonReq('POST', '/api/automations', validRule)

    expect(res.status).toBe(201)
    expect(fs.existsSync(ruleFile(RULE_ID))).toBe(true)
    expect(others).toEqual([RULE_ID])
  })
})

describe('automations CRUD API — vòng đời đọc lại được', () => {
  test('tạo → list → sửa tên → toggle → xoá, mỗi bước đọc lại đúng trạng thái vừa ghi', async () => {
    await jsonReq('POST', '/api/automations', validRule)

    let list = await (await app.request(url('/api/automations'))).json()
    expect(list.automations).toHaveLength(1)
    expect(list.automations[0]).toMatchObject({ id: RULE_ID, name: 'Rule A', enabled: true })
    // State runtime + nextRunAt được tính kèm cho UI.
    expect(list.automations[0].state).toMatchObject({ lastRunAt: null, lastOutcome: null, inFlight: false })

    await jsonReq('PUT', `/api/automations/${RULE_ID}`, { ...validRule, name: 'Rule B' })
    await jsonReq('POST', `/api/automations/${RULE_ID}/toggle`, { enabled: false })

    list = await (await app.request(url('/api/automations'))).json()
    expect(list.automations[0]).toMatchObject({ id: RULE_ID, name: 'Rule B', enabled: false })
    // `updateAutomation` giữ id + createdAt, chỉ đổi updatedAt.
    expect(list.automations[0].createdAt).toBeTruthy()

    await jsonReq('DELETE', `/api/automations/${RULE_ID}`)

    list = await (await app.request(url('/api/automations'))).json()
    expect(list.automations).toEqual([])
  })
})

/**
 * Project đích của action `runTask` (T0d57ff58) qua HTTP.
 *
 * Bất biến: giá trị nào lưu được thì phải chạy được — id sai charset bị chặn
 * ngay ở API chứ không đợi tới lúc chạy rule mới fail.
 */
describe('automations API — project đích của action runTask', () => {
  function ruleWithTarget(over: Record<string, unknown>) {
    return {
      ...validRule,
      actions: [{ kind: 'runTask', mode: 'create', prompt: 'làm việc', ...over }],
    }
  }

  test('lưu project đích hợp lệ → persist xuống file, đọc lại còn nguyên', async () => {
    const res = await jsonReq('POST', '/api/automations', ruleWithTarget({ projectId: 'proj-b-1a2b3c4d' }))
    expect(res.status).toBe(201)

    // Đọc từ đĩa, không chỉ từ response — field phải thật sự được ghi.
    expect(fs.readFileSync(ruleFile(RULE_ID), 'utf8')).toContain('proj-b-1a2b3c4d')

    const list = await (await app.request(url('/api/automations'))).json()
    expect(list.automations[0].actions[0]).toMatchObject({ projectId: 'proj-b-1a2b3c4d' })
  })

  test('mode=existing cũng lưu được project đích', async () => {
    const res = await jsonReq('POST', '/api/automations', {
      ...validRule,
      actions: [{ kind: 'runTask', mode: 'existing', taskId: 'T123', projectId: 'proj-b-1a2b3c4d' }],
    })
    expect(res.status).toBe(201)

    const list = await (await app.request(url('/api/automations'))).json()
    expect(list.automations[0].actions[0]).toMatchObject({ taskId: 'T123', projectId: 'proj-b-1a2b3c4d' })
  })

  test('không chọn project đích → rule lưu bình thường, không mọc khoá projectId', async () => {
    const res = await jsonReq('POST', '/api/automations', validRule)
    expect(res.status).toBe(201)

    expect(fs.readFileSync(ruleFile(RULE_ID), 'utf8')).not.toContain('projectId')

    const list = await (await app.request(url('/api/automations'))).json()
    expect(list.automations[0].actions[0].projectId).toBeUndefined()
  })

  test.each([
    ['chuỗi rỗng', ''],
    ['path traversal', '../other-project'],
    ['có dấu /', 'a/b'],
    ['có khoảng trắng', 'proj b'],
    ['biến {{…}}', '{{trigger.payload.projectId}}'],
    ['quá dài', 'a'.repeat(500)],
  ])('project đích không dùng được (%s) → 4xx, không ghi rule xuống đĩa', async (_label, projectId) => {
    const res = await jsonReq('POST', '/api/automations', ruleWithTarget({ projectId }))

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
    expect(fs.existsSync(ruleFile(RULE_ID))).toBe(false)
    expect(events).toEqual([])
  })
})

describe('GET /api/automations/form-options — danh sách project', () => {
  test('registry rỗng → projects: []', async () => {
    const res = await app.request(url('/api/automations/form-options'))

    expect(res.status).toBe(200)
    expect((await res.json()).projects).toEqual([])
  })

  test('registry có project → trả { id, name, default } cho combobox project đích', async () => {
    const ctx = fakeCtx()
    ctx.registry.list = () => ({
      projects: [
        { id: 'proj-a-1a2b3c4d', name: 'Project A', kind: 'local', path: root, addedAt: '', default: true },
        { id: 'proj-b-5e6f7a8b', name: 'Project B', kind: 'local', path: root, addedAt: '', default: false },
      ],
      defaultId: 'proj-a-1a2b3c4d',
    })
    const appWithProjects = await createApp(ctx)

    const body = await (await appWithProjects.request(url('/api/automations/form-options'))).json()

    expect(body.projects).toEqual([
      { id: 'proj-a-1a2b3c4d', name: 'Project A', default: true },
      { id: 'proj-b-5e6f7a8b', name: 'Project B', default: false },
    ])
  })

  test('registry ném lỗi → projects: [] chứ không 500 (form vẫn lưu được)', async () => {
    const ctx = fakeCtx()
    ctx.registry.list = () => {
      throw new Error('projects.json hỏng')
    }
    const appBroken = await createApp(ctx)

    const res = await appBroken.request(url('/api/automations/form-options'))

    expect(res.status).toBe(200)
    expect((await res.json()).projects).toEqual([])
  })
})
