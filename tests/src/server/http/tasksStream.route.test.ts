import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/backend/apiServer.js'
import type { RegistryContext } from '../../../../src/backend/http/types.js'
import { emit, _resetEventBusForTest } from '../../../../src/backend/events/index.js'
import { readFrame, parseFrame } from './sseTestHelpers.js'

// `GET /api/tasks/stream` (MonitorController.streamTasks) qua Hono test client
// (`app.request`) — không cần dựng http.Server thật (design.md §5).

let root: string
let app: Awaited<ReturnType<typeof createApp>>
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

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

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-tasksstream-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = path.join(root, '.home')
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tasks', 'A1'), { recursive: true })
  fs.writeFileSync(path.join(root, '.dev-state', 'A1.json'), JSON.stringify({ current_phase: 'design' }))
  app = await createApp(fakeCtx())
})

afterAll(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(root, { recursive: true, force: true })
})

afterEach(() => {
  _resetEventBusForTest()
})

describe('GET /api/tasks/stream', () => {
  test('TC-A1: opens with content-type text/event-stream and an immediate snapshot of the current tasks', async () => {
    const res = await app.request('/api/tasks/stream')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')

    const reader = res.body!.getReader()
    const frame = await readFrame(reader)
    expect(frame).not.toBeNull()
    const { type, data } = parseFrame(frame!)
    expect(type).toBe('tasks')
    expect(data.root).toBe(root)
    expect(data.tasks.map((t: any) => t.task_id)).toEqual(['A1'])
    await reader.cancel().catch(() => {})
  })

  test('TC-A2: a relevant lifecycle event (task.advanced) pushes a new snapshot frame', async () => {
    const res = await app.request('/api/tasks/stream')
    const reader = res.body!.getReader()
    await readFrame(reader) // initial snapshot

    emit('task.advanced', { taskId: 'A1' })
    const second = await readFrame(reader)
    expect(second).not.toBeNull()
    expect(parseFrame(second!).type).toBe('tasks')
    await reader.cancel().catch(() => {})
  })

  test('TC-A7: an unrelated event (job.started) does not push a new frame', async () => {
    const res = await app.request('/api/tasks/stream')
    const reader = res.body!.getReader()
    await readFrame(reader) // initial snapshot

    emit('job.started', { jobId: 'j1' })
    const next = await readFrame(reader, 200)
    expect(next).toBeNull() // no frame arrived — timed out
    await reader.cancel().catch(() => {})
  })

  // Bug B (test-spec.md TC-18) — root cause G1: `orchestrator.dispatched` /
  // `orchestrator.halted` không nằm trong `TASK_STREAM_EVENTS`, nên một vòng đời
  // orchestrator đổi (start/halt) mà KHÔNG kèm dispatch step mới không đẩy
  // snapshot nào — dashboard đứng ở "đang lắng nghe" dù orchestrator đã dừng.
  test('TC-18: orchestrator.dispatched pushes a new snapshot even without a step job', async () => {
    const res = await app.request('/api/tasks/stream')
    const reader = res.body!.getReader()
    await readFrame(reader) // initial snapshot

    emit('orchestrator.dispatched', { taskId: 'A1', devTeamRoot: root, action: 'start', stepId: 'implementer' })
    const second = await readFrame(reader)
    expect(second).not.toBeNull()
    expect(parseFrame(second!).type).toBe('tasks')
    await reader.cancel().catch(() => {})
  })

  // TC-17 — orchestrator tự halt (không qua nút Stop) phải cập nhật UI y hệt.
  test('TC-16/TC-17: orchestrator.halted pushes a new snapshot (Stop button OR self-halt)', async () => {
    const res = await app.request('/api/tasks/stream')
    const reader = res.body!.getReader()
    await readFrame(reader) // initial snapshot

    emit('orchestrator.halted', { taskId: 'A1', devTeamRoot: root, reason: 'agent decided to halt' })
    const second = await readFrame(reader)
    expect(second).not.toBeNull()
    expect(parseFrame(second!).type).toBe('tasks')
    await reader.cancel().catch(() => {})
  })

  test('TC-A4: unknown project → 400/404 like the REST fetch-once, no stream opened', async () => {
    const res = await app.request('/api/tasks/stream?project=ghost')
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).not.toContain('text/event-stream')
    expect((await res.json()).error).toBe('unknown project')
  })

  test('TC-F1: closing one connection does not affect another — and a fresh one after that gets a correct snapshot', async () => {
    const resA = await app.request('/api/tasks/stream')
    const resB = await app.request('/api/tasks/stream')
    const readerA = resA.body!.getReader()
    const readerB = resB.body!.getReader()
    await readFrame(readerA)
    await readFrame(readerB)

    await readerA.cancel() // client A disconnects
    await new Promise((r) => setTimeout(r, 20))

    emit('task.advanced', { taskId: 'A1' })
    const stillGetsUpdates = await readFrame(readerB)
    expect(stillGetsUpdates).not.toBeNull()
    expect(parseFrame(stillGetsUpdates!).type).toBe('tasks')

    const resC = await app.request('/api/tasks/stream')
    const readerC = resC.body!.getReader()
    const snapshot = await readFrame(readerC)
    const { data } = parseFrame(snapshot!)
    expect(data.tasks.map((t: any) => t.task_id)).toEqual(['A1'])

    await readerB.cancel().catch(() => {})
    await readerC.cancel().catch(() => {})
  })
})
