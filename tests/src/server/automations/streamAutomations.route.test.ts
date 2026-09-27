import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/backend/apiServer.js'
import type { RegistryContext } from '../../../../src/backend/http/types.js'
import { emit, _resetEventBusForTest } from '../../../../src/backend/events/index.js'
import { readFrame, parseFrame } from '../http/sseTestHelpers.js'

// GET /api/automations/stream (AutomationsController.streamAutomations) — SSE
// thay REST-poll cho danh sách automation + lịch sử run (test-spec.md
// TC08/TC09, Nhóm 3, D3). Không cần interval nội bộ — event bus
// (`automation.*`/`entity.*`) đã đủ, khác với chat/job-log.

const PROJECT_ID = 'proj-automations-stream'

let root: string
let app: Awaited<ReturnType<typeof createApp>>
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

function fakeCtx(): RegistryContext {
  return {
    defaultRoot: root,
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
  name: 'Rule Stream',
  enabled: true,
  triggers: [{ kind: 'timer', startAt: '2026-01-01T00:00:00.000Z', repeat: { mode: 'once' } }],
  actions: [{ kind: 'runTask', mode: 'create', prompt: 'làm việc' }],
}

function url(pathname: string): string {
  return `${pathname}${pathname.includes('?') ? '&' : '?'}project=${PROJECT_ID}`
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-automations-stream-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = path.join(root, '.home')
  fs.mkdirSync(process.env.DEV_TEAM_DASHBOARD_HOME, { recursive: true })
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
})

afterEach(() => {
  _resetEventBusForTest()
})

describe('GET /api/automations/stream', () => {
  test('TC08: snapshot { automations, runs } đầy đủ ngay khi mở kết nối', async () => {
    const create = await app.request(url('/api/automations'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validRule),
    })
    expect(create.status).toBe(201)

    const res = await app.request(url('/api/automations/stream'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')

    const reader = res.body!.getReader()
    const frame = await readFrame(reader)
    const { type, data } = parseFrame(frame!)
    expect(type).toBe('automations')
    expect(data.automations.map((a: any) => a.name)).toEqual(['Rule Stream'])
    expect(data.runs).toEqual([])
    await reader.cancel().catch(() => {})
  })

  test('TC09: tạo automation mới sau khi đã mở kết nối → entity.created đẩy lại snapshot', async () => {
    const res = await app.request(url('/api/automations/stream'))
    const reader = res.body!.getReader()
    const first = await readFrame(reader)
    expect(parseFrame(first!).data.automations).toEqual([])

    const create = await app.request(url('/api/automations'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validRule),
    })
    expect(create.status).toBe(201)

    const next = await readFrame(reader)
    expect(next).not.toBeNull()
    const { type, data } = parseFrame(next!)
    expect(type).toBe('automations')
    expect(data.automations.map((a: any) => a.name)).toEqual(['Rule Stream'])
    await reader.cancel().catch(() => {})
  })

  test('sự kiện không thuộc tập AUTOMATION_STREAM_EVENTS không kích hoạt frame mới', async () => {
    const res = await app.request(url('/api/automations/stream'))
    const reader = res.body!.getReader()
    await readFrame(reader)

    emit('task.advanced', { taskId: 'A1' })
    const next = await readFrame(reader, 200)
    expect(next).toBeNull()
    await reader.cancel().catch(() => {})
  })
})
