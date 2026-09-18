import { describe, expect, test } from 'bun:test'
import { sseResponse } from '../../../../src/backend/http/sseHelper.js'

// Đọc `Response.body` bằng reader — tương đương với những gì `apiServer.ts`
// (`streamSseResponse`) và `sseClient.ts` (FE) thật sự làm với response này.
async function readChunks(res: Response, count: number): Promise<string[]> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const { value, done } = await reader.read()
    if (done) break
    out.push(decoder.decode(value))
  }
  await reader.cancel().catch(() => {})
  return out
}

describe('sseResponse', () => {
  test('sets SSE headers (content-type, no-cache, keep-alive)', () => {
    const res = sseResponse(() => () => {})
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(res.headers.get('cache-control')).toContain('no-cache')
    expect(res.headers.get('connection')).toBe('keep-alive')
  })

  test('subscribe runs immediately; send() enqueues an `event:`/`data:` frame', async () => {
    let sendFn: ((type: string, data: unknown) => void) | null = null
    const res = sseResponse((send) => {
      sendFn = send
      send('tasks', { root: '/r', tasks: [] })
      return () => {}
    })
    expect(sendFn).not.toBeNull()
    const [frame] = await readChunks(res, 1)
    expect(frame).toBe('event: tasks\ndata: {"root":"/r","tasks":[]}\n\n')
  })

  test('multiple send() calls enqueue separate frames, each JSON-parseable', async () => {
    let sendFn!: (type: string, data: unknown) => void
    const res = sseResponse((send) => {
      sendFn = send
      return () => {}
    })
    sendFn('jobs', { jobs: [1] })
    sendFn('jobs', { jobs: [1, 2] })
    const frames = await readChunks(res, 2)
    for (const frame of frames) {
      const m = /^event: (\w+)\ndata: (.+)\n\n$/.exec(frame)
      expect(m).not.toBeNull()
      expect(() => JSON.parse(m![2])).not.toThrow()
    }
  })

  test('cancelling the stream (client disconnect) calls the unsubscribe returned by subscribe', async () => {
    let unsubscribed = false
    const res = sseResponse((send) => {
      send('tasks', { ok: true })
      return () => {
        unsubscribed = true
      }
    })
    const reader = res.body!.getReader()
    await reader.read()
    await reader.cancel()
    expect(unsubscribed).toBe(true)
  })
})
