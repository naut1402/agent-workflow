import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sign } from 'hono/jwt'
import { createApp } from '../../../../src/backend/apiServer.js'
import type { RegistryContext } from '../../../../src/backend/http/types.js'
import { _resetEventBusForTest } from '../../../../src/backend/events/index.js'

// TC-C1/TC-C2 (test-spec.md §C): route `/api/*/stream` phải tuân đúng bất biến
// JWT như mọi route `/api/*` khác — bằng chứng thiết kế chọn fetch-based reader
// (`sseClient.ts`) thay vì `EventSource` gốc (không set được header
// `Authorization`) là đúng: nếu triển khai bằng `EventSource`, request tới đây
// (dùng `fetch` thật của Hono test client, không phải trình duyệt) vẫn sẽ pass,
// nhưng ở production nó sẽ luôn thiếu header và 401 — bài test này khoá lại
// đúng hành vi phía SERVER: route stream không có ngoại lệ nào cho JWT guard.

let root: string
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME
const prevSecret = process.env.DASHBOARD_JWT_SECRET

function fakeCtx(): RegistryContext {
  return {
    defaultRoot: root,
    resolveProjectRoot: (id: string | null) => (id ? null : root),
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

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-streamauth-'))
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
})

afterAll(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(root, { recursive: true, force: true })
})

afterEach(() => {
  _resetEventBusForTest()
  if (prevSecret === undefined) delete process.env.DASHBOARD_JWT_SECRET
  else process.env.DASHBOARD_JWT_SECRET = prevSecret
})

describe('JWT guard applies to /api/tasks/stream and /api/jobs/stream', () => {
  test('TC-C1: secret bật + token hợp lệ → cả 2 stream mở được, không 401', async () => {
    process.env.DEV_TEAM_DASHBOARD_HOME = path.join(root, '.home-ok')
    process.env.DASHBOARD_JWT_SECRET = 'topsecret'
    const app = await createApp(fakeCtx())
    const token = await sign({ sub: 'admin' }, 'topsecret', 'HS256')
    const auth = { Authorization: `Bearer ${token}` }

    const tasksRes = await app.request('/api/tasks/stream', { headers: auth })
    expect(tasksRes.status).not.toBe(401)
    expect(tasksRes.headers.get('content-type')).toBe('text/event-stream')
    await tasksRes.body?.cancel().catch(() => {})

    const jobsRes = await app.request('/api/jobs/stream', { headers: auth })
    expect(jobsRes.status).not.toBe(401)
    expect(jobsRes.headers.get('content-type')).toBe('text/event-stream')
    await jobsRes.body?.cancel().catch(() => {})
  })

  test('TC-C2: secret bật + thiếu token → 401 cho cả 2 stream, giống mọi route /api/* khác', async () => {
    process.env.DEV_TEAM_DASHBOARD_HOME = path.join(root, '.home-401')
    process.env.DASHBOARD_JWT_SECRET = 'topsecret'
    const app = await createApp(fakeCtx())

    const tasksRes = await app.request('/api/tasks/stream')
    expect(tasksRes.status).toBe(401)
    expect(tasksRes.headers.get('content-type') ?? '').not.toContain('text/event-stream')

    const jobsRes = await app.request('/api/jobs/stream')
    expect(jobsRes.status).toBe(401)
    expect(jobsRes.headers.get('content-type') ?? '').not.toContain('text/event-stream')
  })
})
