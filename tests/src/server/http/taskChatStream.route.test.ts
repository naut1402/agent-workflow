import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/backend/apiServer.js'
import type { RegistryContext } from '../../../../src/backend/http/types.js'
import { emit, _resetEventBusForTest } from '../../../../src/backend/events/index.js'
import { readFrame, parseFrame } from './sseTestHelpers.js'

// GET /api/tasks/:id/chat/stream (MonitorController.streamTaskChat) — SSE thay
// REST-poll cho chat (test-spec.md TC05/TC06/TC19, Nhóm 2 + Nhóm 6). Route tự
// tail bằng interval nội bộ (design.md §4.2) + đẩy sớm khi có event vòng đời
// job — ở đây chỉ khoá 2 bất biến quan sát được từ bên ngoài: (a) snapshot
// đầy đủ ngay khi mở kết nối, không cần đợi tick; (b) event vòng đời job đẩy
// lại snapshot ngay, không đợi interval 2.5s (giá trị tick không phải bất
// biến được test theo test-spec.md).

const PROJECT_ID = 'proj-task-chat-stream'

let root: string
let app: Awaited<ReturnType<typeof createApp>>
const prevHome = process.env.DEV_TEAM_DASHBOARD_HOME

function fakeCtx(): RegistryContext {
  return {
    defaultRoot: root,
    resolveProjectRoot: (id: string | null) => (id && id !== PROJECT_ID ? null : root),
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

function seedTask(taskId: string, state: Record<string, unknown>) {
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tasks', taskId), { recursive: true })
  fs.writeFileSync(
    path.join(root, '.dev-state', `${taskId}.json`),
    JSON.stringify({ task_id: taskId, ...state }, null, 2),
    'utf8',
  )
  fs.writeFileSync(path.join(root, 'tasks', taskId, 'request.md'), 'làm việc', 'utf8')
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-taskchat-stream-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = path.join(root, '.home')
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

describe('GET /api/tasks/:id/chat/stream', () => {
  test('400 cho task id không hợp lệ', async () => {
    const res = await app.request(`/api/tasks/..%2Fetc/chat/stream?project=${PROJECT_ID}`)
    expect(res.status).toBe(400)
  })

  test('TC05: snapshot đầy đủ ngay khi mở kết nối, không cần đợi tick', async () => {
    seedTask('CS1', { current_phase: 'implementer' })
    const res = await app.request(`/api/tasks/CS1/chat/stream?project=${PROJECT_ID}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')

    const reader = res.body!.getReader()
    const frame = await readFrame(reader)
    const { type, data } = parseFrame(frame!)
    expect(type).toBe('chat')
    // Task chưa có job hoàn tất — cùng dữ liệu route REST `getTaskChat` trả về
    // (blockedReason) — chứng minh route SSE dùng đúng nguồn `getTaskChatState`.
    expect(data).toMatchObject({ taskId: 'CS1', canSend: false, blockedReason: 'noCompletedJob' })
    await reader.cancel().catch(() => {})
  })

  test('TC06: job lifecycle event đẩy lại snapshot ngay, không đợi tick interval', async () => {
    seedTask('CS2', { current_phase: 'implementer' })
    const res = await app.request(`/api/tasks/CS2/chat/stream?project=${PROJECT_ID}`)
    const reader = res.body!.getReader()
    await readFrame(reader) // snapshot đầu

    emit('job.finished', { jobId: 'j-unrelated-format' })
    const next = await readFrame(reader)
    expect(next).not.toBeNull()
    const { type } = parseFrame(next!)
    expect(type).toBe('chat')
    await reader.cancel().catch(() => {})
  })

  test('TC19: event vòng đời của job task khác không làm hỏng dữ liệu của phiên đang mở — vẫn đúng scope task đang xem', async () => {
    seedTask('CS3', { current_phase: 'implementer' })
    seedTask('CS4', { current_phase: 'implementer' })
    const res = await app.request(`/api/tasks/CS3/chat/stream?project=${PROJECT_ID}`)
    const reader = res.body!.getReader()
    await readFrame(reader)

    // Event của job thuộc task khác (CS4) — route không lọc theo taskId (design.md
    // §4.4 chấp nhận), nhưng vẫn phải đọc lại đúng state của CHÍNH task đang mở.
    emit('job.started', { jobId: 'j-other-task' })
    const next = await readFrame(reader)
    expect(next).not.toBeNull()
    const { data } = parseFrame(next!)
    expect(data.taskId).toBe('CS3')
    await reader.cancel().catch(() => {})
  })
})
