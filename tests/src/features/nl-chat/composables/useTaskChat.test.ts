import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTaskChat } from '@/features/nl-chat/composables/useTaskChat'

// Endpoints exercised:
//   GET  /api/tasks/:id/chat?stepId=&from=  → { turns, total, canSend, blockedReason, running, ... }
//   POST /api/tasks/:id/feedback            → 201 | 409 (step running)

function stubApi(states: any[], opts: { sendStatus?: number } = {}) {
  let call = 0
  const fetchMock = vi.fn(async (input: any, init: any = {}) => {
    const url = String(input)
    const method = (init.method || 'GET').toUpperCase()
    if (url.includes('/feedback') && method === 'POST') {
      const status = opts.sendStatus ?? 201
      return {
        ok: status < 400,
        status,
        json: async () => (status < 400 ? { job: { id: 'j1' } } : { error: 'step already running' }),
      }
    }
    if (url.includes('/chat')) {
      const state = states[Math.min(call, states.length - 1)]
      call += 1
      // Clone: a real response is fresh JSON, and the composable appends to the
      // array it is handed — sharing it would leak between tests.
      return { ok: true, status: 200, json: async () => structuredClone(state) }
    }
    throw new Error(`unexpected fetch: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function make(over: any = {}) {
  return useTaskChat({
    getTaskId: () => 'DEMO-1',
    getStepId: () => 'design',
    getProjectId: () => 'P1',
    ...over,
  })
}

const READY = {
  taskId: 'DEMO-1',
  sessionId: 's1',
  transcriptFound: true,
  turns: [
    { index: 0, role: 'user', text: 'chạy step design' },
    { index: 1, role: 'assistant', text: 'xong rồi' },
  ],
  total: 2,
  running: null,
  canSend: true,
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useTaskChat', () => {
  it('refresh loads the transcript, the cursor and the send-ability flags', async () => {
    const fetchMock = stubApi([READY])
    const c = make()
    await c.refresh(false)

    expect(c.turns.value).toHaveLength(2)
    expect(c.total.value).toBe(2)
    expect(c.sessionId.value).toBe('s1')
    expect(c.canSend.value).toBe(true)
    expect(c.blockedText.value).toBeNull()
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('stepId=design')
    expect(url).toContain('project=P1')
  })

  it('polls incrementally with from=<total> and appends only new turns', async () => {
    const fetchMock = stubApi([
      READY,
      { ...READY, turns: [{ index: 2, role: 'assistant', text: 'thêm câu nữa' }], total: 3 },
    ])
    const c = make()
    await c.refresh(false)
    await c.refresh(true)

    expect(String(fetchMock.mock.calls[1][0])).toContain('from=2')
    expect(c.turns.value.map((t) => t.index)).toEqual([0, 1, 2])
    expect(c.total.value).toBe(3)
  })

  it('does not duplicate a turn the server resends', async () => {
    stubApi([READY, { ...READY, turns: READY.turns, total: 2 }])
    const c = make()
    await c.refresh(false)
    await c.refresh(true)
    expect(c.turns.value).toHaveLength(2)
  })

  it('explains a blocked input instead of leaving it silently disabled', async () => {
    stubApi([{ ...READY, canSend: false, blockedReason: 'noSession', running: null }])
    const c = make()
    await c.refresh(false)

    expect(c.canSend.value).toBe(false)
    expect(c.blockedText.value).toContain('phiên CLI')
  })

  it('a running step no longer disables sending — shows a "queued" hint instead', async () => {
    stubApi([{ ...READY, canSend: true, queued: true, running: { jobId: 'j9', stepId: 'design' } }])
    const c = make()
    await c.refresh(false)

    expect(c.canSend.value).toBe(true)
    expect(c.queued.value).toBe(true)
    expect(c.blockedText.value).toContain('Đã ghi nhận')
    expect(c.running.value).toMatchObject({ jobId: 'j9' })
  })

  it('send posts the feedback with the step id + chat feedback mode and echoes it until the transcript catches up', async () => {
    const fetchMock = stubApi([READY, { ...READY, turns: [], total: 2 }])
    const c = make()
    await c.refresh(false)
    await c.send('sửa lại phần A')

    const post = fetchMock.mock.calls.find(([, init]: any[]) => init?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ feedback: 'sửa lại phần A', stepId: 'design', mode: 'queue' })
    // Not in the transcript yet → still shown as pending.
    expect(c.pending.value).toEqual(['sửa lại phần A'])
  })

  it('drops the optimistic echo once the transcript contains new turns', async () => {
    stubApi([READY, { ...READY, turns: [{ index: 2, role: 'user', text: 'sửa lại phần A' }], total: 3 }])
    const c = make()
    await c.refresh(false)
    await c.send('sửa lại phần A')

    expect(c.pending.value).toEqual([])
    expect(c.turns.value.map((t) => t.index)).toEqual([0, 1, 2])
  })

  it('a 409 from the server is reported as "step đang chạy", not a raw HTTP error', async () => {
    stubApi([READY], { sendStatus: 409 })
    const c = make()
    await c.refresh(false)
    await c.send('hi')

    expect(c.error.value).toContain('Step đang chạy')
    expect(c.pending.value).toEqual([])
  })

  it('start polls faster while a step runs and stop() ends the loop', async () => {
    vi.useFakeTimers()
    const fetchMock = stubApi([{ ...READY, canSend: true, queued: true, running: { jobId: 'j9' } }])
    const c = make({ runningPollMs: 1000, idlePollMs: 60_000 })
    await c.start()
    const afterStart = fetchMock.mock.calls.length

    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock.mock.calls.length).toBe(afterStart + 1)

    c.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchMock.mock.calls.length).toBe(afterStart + 1)
    vi.useRealTimers()
  })
})
