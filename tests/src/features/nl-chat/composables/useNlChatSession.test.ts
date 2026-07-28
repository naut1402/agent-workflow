import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNlChatSession } from '@/features/nl-chat/composables/useNlChatSession'

// Endpoints exercised:
//   POST /api/nl-chat/sessions            → { chatSessionId, job }
//   POST /api/nl-chat/sessions/:id/messages → { job }
//   GET  /api/jobs/:id                     → { job } (poll)
//   GET  /api/nl-chat/sessions/:id         → { kind, draft|text }
//   POST /api/tasks | /api/pipeline-profiles | /api/custom-agents → confirm
//   POST /api/nl-chat/sessions/:id/cancel  → { cancelled: true }

function stubApi(opts: {
  chatSessionId?: string
  job?: any
  jobStates?: any[]
  turn?: any
  confirmOk?: boolean
}) {
  let jobCall = 0
  const fetchMock = vi.fn(async (input: any, init: any = {}) => {
    const url = String(input)
    const method = (init.method || 'GET').toUpperCase()
    if (url.includes('/api/nl-chat/sessions') && url.includes('/messages') && method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ job: opts.job ?? { id: 'jobZ', status: 'queued' } }) }
    }
    if (url.includes('/api/nl-chat/sessions') && url.includes('/cancel') && method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ cancelled: true }) }
    }
    if (url.includes('/api/nl-chat/sessions') && method === 'POST') {
      return {
        ok: true,
        status: 201,
        json: async () => ({ chatSessionId: opts.chatSessionId ?? 'nlchat-abc', job: opts.job ?? { id: 'jobZ', status: 'queued' } }),
      }
    }
    if (url.includes('/api/nl-chat/sessions/') && method === 'GET') {
      return { ok: true, status: 200, json: async () => opts.turn ?? { status: 'ready', kind: 'question', text: '?' } }
    }
    if (url.includes('/api/jobs/') && method === 'GET') {
      const states = opts.jobStates ?? [{ id: 'jobZ', status: 'succeeded' }]
      const job = states[Math.min(jobCall, states.length - 1)]
      jobCall += 1
      return { ok: true, status: 200, json: async () => ({ job }) }
    }
    if ((url.includes('/api/tasks') || url.includes('/api/pipeline-profiles') || url.includes('/api/custom-agents')) && method === 'POST') {
      if (opts.confirmOk === false) return { ok: false, status: 400, json: async () => ({ error: 'bad request' }) }
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }
    throw new Error(`unexpected fetch: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function make(overrides: any = {}) {
  return useNlChatSession({ getProjectId: () => undefined, pollMs: 1, maxWaitMs: 200, ...overrides })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useNlChatSession', () => {
  it('selectEntity moves to chatting', () => {
    const s = make()
    s.selectEntity('task')
    expect(s.entityType.value).toBe('task')
    expect(s.step.value).toBe('chatting')
  })

  it('sendMessage on a fresh session starts a chat and appends the assistant question', async () => {
    stubApi({ turn: { status: 'ready', kind: 'question', text: 'Bạn muốn đặt tên task là gì?' } })
    const s = make()
    s.selectEntity('task')
    await s.sendMessage('tạo task sửa bug')

    expect(s.chatSessionId.value).toBe('nlchat-abc')
    expect(s.step.value).toBe('chatting')
    expect(s.messages.value.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(s.messages.value[1].text).toBe('Bạn muốn đặt tên task là gì?')
  })

  it('sendMessage moves to previewDraft once the agent returns a draft', async () => {
    stubApi({ turn: { status: 'ready', kind: 'draft', draft: { taskId: 't1', prompt: 'p' } } })
    const s = make()
    s.selectEntity('task')
    await s.sendMessage('đủ thông tin rồi')

    expect(s.step.value).toBe('previewDraft')
    expect(s.draft.value).toEqual({ taskId: 't1', prompt: 'p' })
  })

  it('sendMessage on an existing session calls the messages endpoint, not sessions', async () => {
    const fetchMock = stubApi({ turn: { status: 'ready', kind: 'question', text: 'again?' } })
    const s = make()
    s.selectEntity('agent')
    await s.sendMessage('lượt 1')
    fetchMock.mockClear()
    await s.sendMessage('lượt 2')

    const calledMessagesEndpoint = fetchMock.mock.calls.some(([url]: any[]) => String(url).includes('/messages'))
    expect(calledMessagesEndpoint).toBe(true)
  })

  it('a failed job surfaces an error and moves to the error step', async () => {
    stubApi({ jobStates: [{ id: 'jobZ', status: 'failed', error: 'runner disabled' }] })
    const s = make()
    s.selectEntity('task')
    await s.sendMessage('m')

    expect(s.step.value).toBe('error')
    expect(s.error.value).toContain('runner disabled')
  })

  it('confirm(task) posts the edited draft then moves to done', async () => {
    stubApi({ turn: { status: 'ready', kind: 'draft', draft: { taskId: 't1', prompt: 'p' } }, confirmOk: true })
    const s = make()
    s.selectEntity('task')
    await s.sendMessage('m')
    await s.confirm({ taskId: 't1', prompt: 'p edited' })

    expect(s.step.value).toBe('done')
  })

  it('confirm surfaces a failed create without throwing', async () => {
    stubApi({ turn: { status: 'ready', kind: 'draft', draft: { taskId: 't1', prompt: 'p' } }, confirmOk: false })
    const s = make()
    s.selectEntity('task')
    await s.sendMessage('m')
    await s.confirm({ taskId: 't1', prompt: 'p' })

    expect(s.step.value).toBe('error')
    expect(s.error.value).toBeTruthy()
  })

  it('cancel resets to selectEntity', async () => {
    stubApi({ turn: { status: 'ready', kind: 'question', text: '?' } })
    const s = make()
    s.selectEntity('pipeline')
    await s.sendMessage('m')
    await s.cancel()

    expect(s.step.value).toBe('selectEntity')
    expect(s.chatSessionId.value).toBeNull()
    expect(s.messages.value).toEqual([])
  })
})
