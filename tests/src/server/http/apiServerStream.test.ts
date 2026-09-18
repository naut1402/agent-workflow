import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApiHandler } from '../../../../src/backend/apiServer.js'
import type { RegistryContext } from '../../../../src/backend/http/types.js'
import { emit, _resetEventBusForTest } from '../../../../src/backend/events/index.js'

// Bridge Node↔Hono cho route `text/event-stream` (`streamSseResponse` trong
// `apiServer.ts`) chưa có suite nào phủ trước đây (review.md [must] #2). Ba
// hành vi cần khoá: (a) pipe theo chunk chứ không buffer toàn bộ như path JSON
// thường — regression guard ở (b); (c) `req` đóng giữa chừng → unsubscribe
// khỏi event bus (không rò rỉ handler cũ).

let root: string
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

/** Node `req` tối thiểu: EventEmitter (cho `req.on('close', …)`) + field `nodeToWebRequest` đọc. */
function fakeReq(url: string) {
  const req = new EventEmitter() as EventEmitter & {
    url: string
    method: string
    headers: Record<string, string>
    socket: { remoteAddress: string }
  }
  req.url = url
  req.method = 'GET'
  req.headers = {}
  req.socket = { remoteAddress: '127.0.0.1' }
  return req
}

/** Node `res` tối thiểu — ghi lại từng lần `write()` riêng biệt với `end()`. */
function fakeRes() {
  const chunks: Buffer[] = []
  let endedWith: Buffer | null = null
  const res = {
    statusCode: 200,
    writableEnded: false,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v
    },
    flushHeaders() {},
    write(buf: Buffer) {
      chunks.push(Buffer.from(buf))
      return true
    },
    end(buf?: Buffer) {
      if (buf) endedWith = Buffer.from(buf)
      this.writableEnded = true
    },
  }
  return { res, chunks, endedWith: () => endedWith }
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-apiserver-stream-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = path.join(root, '.home')
  fs.mkdirSync(path.join(root, '.dev-state'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tasks', 'A1'), { recursive: true })
  fs.writeFileSync(path.join(root, '.dev-state', 'A1.json'), JSON.stringify({ current_phase: 'design' }))
})

afterAll(() => {
  if (prevHome === undefined) delete process.env.DEV_TEAM_DASHBOARD_HOME
  else process.env.DEV_TEAM_DASHBOARD_HOME = prevHome
  fs.rmSync(root, { recursive: true, force: true })
})

afterEach(() => {
  _resetEventBusForTest()
})

describe('apiServer — text/event-stream bridge', () => {
  test('pipes the SSE response by chunk (>=1 write before the connection ends), sets the stream headers', async () => {
    const handle = createApiHandler(fakeCtx())
    const req = fakeReq('/api/tasks/stream')
    const { res, chunks } = fakeRes()

    const donePromise = handle(req as any, res as any)
    await new Promise((r) => setTimeout(r, 20)) // let the initial snapshot flush

    expect(res.headers['content-type']).toBe('text/event-stream')
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    const firstFrame = Buffer.concat(chunks).toString()
    expect(firstFrame).toContain('event: tasks')

    req.emit('close')
    await donePromise
    expect(res.writableEnded).toBe(true)
  })

  test('an unrelated response (regular JSON route) still buffers into a single end(), no write()', async () => {
    const handle = createApiHandler(fakeCtx())
    const req = fakeReq('/api/tasks')
    const { res, chunks, endedWith } = fakeRes()

    const handled = await handle(req as any, res as any)

    expect(handled).toBe(true)
    expect(res.headers['content-type']).not.toContain('text/event-stream')
    expect(chunks.length).toBe(0) // never streamed by chunk
    expect(endedWith()).not.toBeNull() // buffered whole body into end(buf)
    const body = JSON.parse(endedWith()!.toString())
    expect(body.root).toBe(root)
  })

  test('client disconnect (req "close") unsubscribes — no further frame is written after close', async () => {
    const handle = createApiHandler(fakeCtx())
    const req = fakeReq('/api/tasks/stream')
    const { res, chunks } = fakeRes()

    const donePromise = handle(req as any, res as any)
    await new Promise((r) => setTimeout(r, 20))
    const countAtOpen = chunks.length

    emit('task.advanced', { taskId: 'A1' })
    await new Promise((r) => setTimeout(r, 20))
    expect(chunks.length).toBeGreaterThan(countAtOpen) // still listening → new frame pushed

    req.emit('close')
    await donePromise
    const countAtClose = chunks.length

    emit('task.advanced', { taskId: 'A1' })
    await new Promise((r) => setTimeout(r, 20))
    expect(chunks.length).toBe(countAtClose) // unsubscribed — no leaked handler
  })
})
