import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNlChatSession } from '@/features/nl-chat/composables/useNlChatSession'

// Endpoints exercised:
//   POST /api/nl-chat/sessions            → { chatSessionId, job }
//   POST /api/nl-chat/sessions/:id/messages → { job }
//   GET  /api/jobs/:id                     → { job } (poll)
//   GET  /api/nl-chat/sessions/:id         → { kind, draft|text }
//   GET  /api/catalog                      → { skills, agents } (pipeline draft agent-ref guard)
//   POST /api/tasks | /api/pipeline-profiles | /api/custom-agents → confirm
//   POST /api/nl-chat/sessions/:id/cancel  → { cancelled: true }

function stubApi(opts: {
  chatSessionId?: string
  job?: any
  jobStates?: any[]
  turn?: any
  confirmOk?: boolean
  catalog?: any
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
    if (url.includes('/api/catalog') && method === 'GET') {
      return { ok: true, status: 200, json: async () => opts.catalog ?? { skills: [], agents: [{ id: 'agent-a' }, { id: 'agent-b' }] } }
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
  it('opens straight into a normal chat — no entity picker step', () => {
    const s = make()
    expect(s.step.value).toBe('chatting')
    expect(s.entityType.value).toBeNull()
  })

  it('sendMessage on a fresh session starts a chat and appends the assistant question', async () => {
    stubApi({ turn: { status: 'ready', kind: 'question', text: 'Bạn muốn đặt tên task là gì?' } })
    const s = make()
    await s.sendMessage('tạo task sửa bug')

    expect(s.chatSessionId.value).toBe('nlchat-abc')
    expect(s.step.value).toBe('chatting')
    expect(s.messages.value.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(s.messages.value[1].text).toBe('Bạn muốn đặt tên task là gì?')
  })

  it('sendMessage moves to previewDraft once the agent returns a draft', async () => {
    stubApi({ turn: { status: 'ready', kind: 'draft', entityType: 'task', draft: { taskId: 't1', prompt: 'p' } } })
    const s = make()
    await s.sendMessage('đủ thông tin rồi')

    expect(s.step.value).toBe('previewDraft')
    expect(s.draft.value).toEqual({ taskId: 't1', prompt: 'p' })
  })

  it('adopts the entity type the agent reports with the draft', async () => {
    stubApi({
      turn: { status: 'ready', kind: 'draft', entityType: 'agent', draft: { name: 'a' } },
    })
    const s = make()
    await s.sendMessage('tạo cho mình một agent')

    expect(s.entityType.value).toBe('agent')
    expect(s.step.value).toBe('previewDraft')
  })

  it('a draft with no entity type keeps the chat open and asks instead of previewing', async () => {
    stubApi({ turn: { status: 'ready', kind: 'draft', draft: { foo: 1 } } })
    const s = make()
    await s.sendMessage('m')

    expect(s.step.value).toBe('chatting')
    expect(s.entityType.value).toBeNull()
    expect(s.messages.value[1].role).toBe('assistant')
  })

  it('a pinned entity type still wins when the agent omits it', async () => {
    stubApi({ turn: { status: 'ready', kind: 'draft', draft: { taskId: 't1', prompt: 'p' } }, confirmOk: true })
    const s = make()
    s.selectEntity('task')
    await s.sendMessage('m')

    expect(s.step.value).toBe('previewDraft')
    expect(s.entityType.value).toBe('task')
  })

  it('sendMessage on an existing session calls the messages endpoint, not sessions', async () => {
    const fetchMock = stubApi({ turn: { status: 'ready', kind: 'question', text: 'again?' } })
    const s = make()
    await s.sendMessage('lượt 1')
    fetchMock.mockClear()
    await s.sendMessage('lượt 2')

    const calledMessagesEndpoint = fetchMock.mock.calls.some(([url]: any[]) => String(url).includes('/messages'))
    expect(calledMessagesEndpoint).toBe(true)
  })

  it('a failed job surfaces an error and moves to the error step', async () => {
    stubApi({ jobStates: [{ id: 'jobZ', status: 'failed', error: 'runner disabled' }] })
    const s = make()
    await s.sendMessage('m')

    expect(s.step.value).toBe('error')
    expect(s.error.value).toContain('runner disabled')
  })

  it('confirm(task) posts the edited draft then moves to done', async () => {
    stubApi({ turn: { status: 'ready', kind: 'draft', entityType: 'task', draft: { taskId: 't1', prompt: 'p' } }, confirmOk: true })
    const s = make()
    await s.sendMessage('m')
    await s.confirm({ taskId: 't1', prompt: 'p edited' })

    expect(s.step.value).toBe('done')
  })

  it('confirm(task) mints a random taskId when the draft omits one', async () => {
    const fetchMock = stubApi({
      turn: { status: 'ready', kind: 'draft', entityType: 'task', draft: { prompt: 'p' } },
      confirmOk: true,
    })
    const s = make()
    await s.sendMessage('m')
    await s.confirm({ prompt: 'p without id' })

    expect(s.step.value).toBe('done')
    const createCall = fetchMock.mock.calls.find(
      ([url, init]: any[]) => String(url).includes('/api/tasks') && (init?.method || 'GET').toUpperCase() === 'POST',
    )
    expect(createCall).toBeTruthy()
    const body = JSON.parse(createCall![1].body)
    expect(body.prompt).toBe('p without id')
    expect(body.taskId).toMatch(/^T[0-9a-f]{8}$/)
  })

  it('confirm surfaces a failed create without throwing', async () => {
    stubApi({ turn: { status: 'ready', kind: 'draft', entityType: 'task', draft: { taskId: 't1', prompt: 'p' } }, confirmOk: false })
    const s = make()
    await s.sendMessage('m')
    await s.confirm({ taskId: 't1', prompt: 'p' })

    expect(s.step.value).toBe('error')
    expect(s.error.value).toBeTruthy()
  })

  it('confirm(pipeline) blocks and errors when a draft.steps[].agent ref is not in the catalog', async () => {
    stubApi({
      turn: { status: 'ready', kind: 'draft', entityType: 'pipeline', draft: { steps: [{ agent: 'agent-a' }, { agent: 'ghost-agent' }] } },
      catalog: { skills: [], agents: [{ id: 'agent-a' }, { id: 'agent-b' }] },
    })
    const s = make()
    await s.sendMessage('tạo pipeline 2 bước')
    expect(s.step.value).toBe('previewDraft')

    // catalog fetch fired by sendMessage's draft branch is async — wait for it to land.
    await new Promise((r) => setTimeout(r, 5))

    await s.confirm({ steps: [{ agent: 'agent-a' }, { agent: 'ghost-agent' }] })

    expect(s.step.value).toBe('previewDraft')
    expect(s.error.value).toContain('ghost-agent')
  })

  it('confirm(pipeline) succeeds when every draft.steps[].agent ref is in the catalog', async () => {
    stubApi({
      turn: { status: 'ready', kind: 'draft', entityType: 'pipeline', draft: { steps: [{ agent: 'agent-a' }, { agent: 'agent-b' }] } },
      catalog: { skills: [], agents: [{ id: 'agent-a' }, { id: 'agent-b' }] },
      confirmOk: true,
    })
    const s = make()
    s.pipelineName.value = 'my-pipeline'
    await s.sendMessage('tạo pipeline hợp lệ')
    await new Promise((r) => setTimeout(r, 5))

    await s.confirm({ steps: [{ agent: 'agent-a' }, { agent: 'agent-b' }] })

    expect(s.step.value).toBe('done')
    expect(s.error.value).toBeNull()
  })

  it('normalizes a pipeline draft (step ids) for both the preview and the saved profile', async () => {
    const fetchMock = stubApi({
      turn: { status: 'ready', kind: 'draft', entityType: 'pipeline', draft: { steps: [{ agent: 'agent-a' }] } },
      catalog: { skills: [], agents: [{ id: 'agent-a' }] },
      confirmOk: true,
    })
    const s = make()
    s.pipelineName.value = 'p1'
    await s.sendMessage('tạo pipeline')
    await new Promise((r) => setTimeout(r, 5))

    // Preview shows what will be saved: ids present, not the bare agent-only step.
    expect(s.draft.value).toMatchObject({ version: 1, steps: [{ id: 'agent-a', name: 'agent-a' }] })

    // A user who edits the ids back out still gets a reopenable profile.
    await s.confirm({ steps: [{ agent: 'agent-a' }] })
    const body = JSON.parse(
      fetchMock.mock.calls.find(([url]: any[]) => String(url).includes('/api/pipeline-profiles'))![1].body,
    )
    expect(body.pipeline.steps[0].id).toBe('agent-a')
  })

  it('confirm(task)/confirm(agent) are unaffected by the pipeline agent-ref guard', async () => {
    stubApi({ turn: { status: 'ready', kind: 'draft', entityType: 'task', draft: { taskId: 't1', prompt: 'p' } }, confirmOk: true })
    const s = make()
    await s.sendMessage('m')

    await s.confirm({ taskId: 't1', prompt: 'p edited' })

    expect(s.step.value).toBe('done')
  })

  it('cancel resets back to an empty chat', async () => {
    stubApi({ turn: { status: 'ready', kind: 'question', text: '?' } })
    const s = make()
    await s.sendMessage('m')
    await s.cancel()

    expect(s.step.value).toBe('chatting')
    expect(s.chatSessionId.value).toBeNull()
    expect(s.messages.value).toEqual([])
  })
})
