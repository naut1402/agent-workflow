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
    stubApi([{ ...READY, canSend: false, blockedReason: 'noCompletedJob', running: null }])
    const c = make()
    await c.refresh(false)

    expect(c.canSend.value).toBe(false)
    expect(c.blockedText.value).toContain('job nào hoàn tất')
  })

  it('a running step no longer disables sending — shows a "queued" hint instead', async () => {
    stubApi([{ ...READY, canSend: true, queued: true, running: { jobId: 'j9', stepId: 'design' } }])
    const c = make()
    await c.refresh(false)

    expect(c.canSend.value).toBe(true)
    expect(c.queued.value).toBe(true)
    expect(c.blockedText.value).toContain('sẽ được gửi')
    expect(c.running.value).toMatchObject({ jobId: 'j9' })
  })

  it('send posts the feedback with the step id + chat feedback mode and echoes it until the transcript catches up', async () => {
    const fetchMock = stubApi([
      READY,
      // Job still running — no assistant yet; full reload while pending must keep the echo.
      { ...READY, turns: READY.turns, total: 2, running: { jobId: 'j-fb', stepId: 'design' } },
    ])
    const c = make()
    await c.refresh(false)
    await c.send('sửa lại phần A')

    const post = fetchMock.mock.calls.find(([, init]: any[]) => init?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ feedback: 'sửa lại phần A', stepId: 'design', mode: 'queue' })
    // Not in the transcript yet → still shown as pending.
    expect(c.pending.value).toEqual(['sửa lại phần A'])
    // Pending forces from=0 (not a stale incremental cursor).
    const chatGets = fetchMock.mock.calls.filter(([url]: any[]) => String(url).includes('/chat'))
    expect(String(chatGets[chatGets.length - 1][0])).not.toContain('from=')
  })

  it('drops the optimistic echo once the transcript contains new turns', async () => {
    stubApi([
      READY,
      {
        ...READY,
        turns: [
          ...READY.turns,
          { index: 2, role: 'user', text: 'sửa lại phần A' },
          { index: 3, role: 'assistant', text: 'đã sửa' },
        ],
        total: 4,
        running: null,
      },
    ])
    const c = make()
    await c.refresh(false)
    await c.send('sửa lại phần A')

    expect(c.pending.value).toEqual([])
    expect(c.turns.value.map((t) => t.index)).toEqual([0, 1, 2, 3])
  })

  it('clears Đang gửi when job-fallback returns a fresh 0-based timeline after success', async () => {
    // Reproduces stuck pending: prior total=2, then server synthesizes only the
    // feedback job as indices 0..1 — incremental from=2 would return [] forever.
    stubApi([
      READY,
      {
        taskId: 'DEMO-1',
        sessionId: 's1',
        transcriptFound: true,
        turns: [
          { index: 0, role: 'user', text: 'hello' },
          { index: 1, role: 'assistant', text: 'Chào bạn từ stdout' },
        ],
        total: 2,
        running: null,
        canSend: true,
      },
    ])
    const c = make()
    await c.refresh(false)
    await c.send('hello')

    expect(c.pending.value).toEqual([])
    expect(c.turns.value.map((t) => t.text)).toEqual(['hello', 'Chào bạn từ stdout'])
  })

  it('a 409 from the server is reported as "step đang chạy", not a raw HTTP error', async () => {
    stubApi([READY], { sendStatus: 409 })
    const c = make()
    await c.refresh(false)
    await c.send('hi')

    expect(c.error.value).toContain('Step đang chạy')
    expect(c.pending.value).toEqual([])
  })

  it('sortedTurns reorders by `at` for display without touching raw turns/index', async () => {
    stubApi([
      {
        ...READY,
        turns: [
          { index: 0, role: 'assistant', text: 'muộn hơn', at: '2026-01-01T00:00:05Z' },
          { index: 1, role: 'user', text: 'sớm hơn', at: '2026-01-01T00:00:01Z' },
        ],
      },
    ])
    const c = make()
    await c.refresh(false)

    expect(c.turns.value.map((t) => t.index)).toEqual([0, 1])
    expect(c.sortedTurns.value.map((t) => t.index)).toEqual([1, 0])
  })

  it('sortedTurns falls back to raw order when any turn is missing a parseable `at`', async () => {
    stubApi([
      {
        ...READY,
        turns: [
          { index: 0, role: 'assistant', text: 'muộn hơn', at: '2026-01-01T00:00:05Z' },
          { index: 1, role: 'user', text: 'không có at' },
        ],
      },
    ])
    const c = make()
    await c.refresh(false)

    expect(c.sortedTurns.value.map((t) => t.index)).toEqual([0, 1])
  })

  it('timeline slots a pending echo by send time instead of always appending it last', async () => {
    // Sent "now" (real Date.now()) must land between an old turn and a turn
    // timestamped far in the future — proving `timeline` sorts by `at` rather than
    // just concatenating pending after sortedTurns (the bug in the issue screenshot).
    stubApi([
      {
        ...READY,
        turns: [
          { index: 0, role: 'user', text: 'cũ', at: '2020-01-01T00:00:00Z' },
          { index: 1, role: 'assistant', text: 'trong tương lai', at: '2099-01-01T00:00:00Z' },
        ],
        running: { jobId: 'j-pending' },
      },
    ])
    const c = make()
    await c.refresh(false)
    await c.send('gửi bây giờ')

    expect(c.pending.value).toEqual(['gửi bây giờ'])
    expect(c.timeline.value.map((t) => t.text)).toEqual(['cũ', 'gửi bây giờ', 'trong tương lai'])
  })

  it('timeline falls back to append-at-end when turns are missing a parseable `at` (regression)', async () => {
    stubApi([
      {
        ...READY,
        turns: [{ index: 0, role: 'user', text: 'không có at' }],
        running: { jobId: 'j-pending' },
      },
    ])
    const c = make()
    await c.refresh(false)
    await c.send('tin nhắn mới')

    expect(c.pending.value).toEqual(['tin nhắn mới'])
    expect(c.timeline.value.map((t) => t.text)).toEqual(['không có at', 'tin nhắn mới'])
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

  /**
   * `TaskChatBody` calls `start()` from mount, from the re-scope watcher and
   * from the active watcher, so overlapping calls are the normal case rather
   * than an edge one. Each surviving chain polls on its own timer against the
   * same session, so a leaked one shows up as doubled request traffic and as
   * state written by whichever chain answers last.
   */
  it('overlapping start() calls leave exactly one poll chain', async () => {
    vi.useFakeTimers()
    const fetchMock = stubApi([{ ...READY, running: { jobId: 'j9' } }])
    const c = make({ runningPollMs: 1000, idlePollMs: 60_000 })

    await Promise.all([c.start(), c.start(), c.start()])
    const afterStart = fetchMock.mock.calls.length

    // One tick must produce exactly one request — three chains would make three.
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock.mock.calls.length).toBe(afterStart + 1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock.mock.calls.length).toBe(afterStart + 2)

    c.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchMock.mock.calls.length).toBe(afterStart + 2)
    vi.useRealTimers()
  })

  it('stop() during an in-flight refresh keeps its response out of the state', async () => {
    let release: (() => void) | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: any) => {
        if (!String(input).includes('/chat')) throw new Error('unexpected fetch')
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return { ok: true, status: 200, json: async () => structuredClone(READY) }
      }),
    )

    const c = make()
    const pending = c.start()
    c.stop()
    release!()
    await pending

    // The chain was cancelled mid-flight, so its answer must not land.
    expect(c.turns.value).toEqual([])
    expect(c.sessionId.value).toBeNull()
    expect(c.loading.value).toBe(false)
  })

  it('a superseded chain does not overwrite the newer one\'s transcript', async () => {
    const releases: (() => void)[] = []
    const bodies = [
      { ...READY, sessionId: 'cũ', turns: [{ index: 0, role: 'user', text: 'phiên cũ' }], total: 1 },
      { ...READY, sessionId: 'mới', turns: [{ index: 0, role: 'user', text: 'phiên mới' }], total: 1 },
    ]
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: any) => {
        if (!String(input).includes('/chat')) throw new Error('unexpected fetch')
        const body = bodies[Math.min(call, bodies.length - 1)]
        call += 1
        await new Promise<void>((resolve) => releases.push(resolve))
        return { ok: true, status: 200, json: async () => structuredClone(body) }
      }),
    )

    const c = make()
    const first = c.start()
    const second = c.start()
    // The first request answers LAST — the ordering that makes a stale write win.
    releases[1]()
    releases[0]()
    await Promise.all([first, second])

    expect(c.sessionId.value).toBe('mới')
    expect(c.turns.value.map((t: any) => t.text)).toEqual(['phiên mới'])
  })
})
