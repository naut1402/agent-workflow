import { afterEach, describe, expect, it, vi } from 'vitest'
import { openSseStream } from '@/frontend/lib/sseClient'
import { makeSseStream } from '../../helpers/sseStream'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('openSseStream', () => {
  it('fetches the given path + query, calls onOpen, and parses the first frame', async () => {
    const sse = makeSseStream()
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: true,
      body: sse.stream,
    }))
    vi.stubGlobal('fetch', fetchMock)

    const onOpen = vi.fn()
    const events: Array<[string, unknown]> = []
    const stream = openSseStream('/api/tasks/stream', { project: 'p1' }, {
      onOpen,
      onEvent: (type, data) => events.push([type, data]),
    })

    await vi.waitUntil(() => onOpen.mock.calls.length > 0)
    const [input, init] = fetchMock.mock.calls[0]!
    expect(String(input)).toBe('/api/tasks/stream?project=p1')
    expect((init!.headers as Record<string, string>).Accept).toBe('text/event-stream')

    sse.push('tasks', { root: '/r', tasks: [] })
    await vi.waitUntil(() => events.length > 0)
    expect(events[0]).toEqual(['tasks', { root: '/r', tasks: [] }])

    stream.close()
  })

  it('reassembles a frame split across two chunks before parsing it', async () => {
    const sse = makeSseStream()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, body: sse.stream })))

    const events: Array<[string, unknown]> = []
    const stream = openSseStream('/api/jobs/stream', undefined, {
      onEvent: (type, data) => events.push([type, data]),
    })

    sse.pushRaw('event: jobs\ndata: {"jobs"')
    await new Promise((r) => setTimeout(r, 10))
    expect(events).toHaveLength(0) // frame chưa đủ — chưa parse

    sse.pushRaw(':[]}\n\n')
    await vi.waitUntil(() => events.length > 0)
    expect(events[0]).toEqual(['jobs', { jobs: [] }])

    stream.close()
  })

  it('reconnects with backoff when the stream ends unexpectedly', async () => {
    const sse1 = makeSseStream()
    const sse2 = makeSseStream()
    const fetchMock = vi.fn(async () => ({
      ok: true,
      body: fetchMock.mock.calls.length === 1 ? sse1.stream : sse2.stream,
    }))
    vi.stubGlobal('fetch', fetchMock)

    const events: Array<[string, unknown]> = []
    const stream = openSseStream('/api/tasks/stream', undefined, {
      onEvent: (type, data) => events.push([type, data]),
    })

    await vi.waitUntil(() => fetchMock.mock.calls.length === 1)
    sse1.close() // kết thúc bất thường (không phải do stop())

    await vi.waitUntil(() => fetchMock.mock.calls.length === 2, { timeout: 3000, interval: 25 })
    sse2.push('tasks', { root: '/r2', tasks: [] })
    await vi.waitUntil(() => events.length > 0)
    expect(events[0]).toEqual(['tasks', { root: '/r2', tasks: [] }])

    stream.close()
  })

  it('close() marks the connection stopped — the stream ending afterwards does not reconnect or error', async () => {
    const sse = makeSseStream()
    const fetchMock = vi.fn(async () => ({ ok: true, body: sse.stream }))
    vi.stubGlobal('fetch', fetchMock)

    const onError = vi.fn()
    const events: Array<[string, unknown]> = []
    const stream = openSseStream('/api/tasks/stream', undefined, {
      onEvent: (type, data) => events.push([type, data]),
      onError,
    })

    sse.push('tasks', { root: '/r', tasks: [] })
    await vi.waitUntil(() => events.length > 0)

    stream.close() // stopped=true + abort() — reader.read() vẫn đang chờ chunk kế tiếp
    sse.close() // server đóng kết nối ngay sau đó → unblock reader.read() với {done:true}
    await new Promise((r) => setTimeout(r, 50))

    expect(onError).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1) // không reconnect sau khi đã stop() chủ động
  })
})
