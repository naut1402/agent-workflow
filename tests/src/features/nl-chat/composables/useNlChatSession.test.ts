import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNlChatSession } from '@/features/nl-chat/composables/useNlChatSession'

// Endpoints exercised:
//   POST /api/nl-chat/sessions            → { chatSessionId, job }
//   POST /api/nl-chat/sessions/:id/messages → { job }
//   GET  /api/jobs/:id                     → { job } (poll)
//   GET  /api/nl-chat/sessions/:id         → { kind, draft|text }
//   GET  /api/catalog                      → { skills, agents } (pipeline draft agent-ref guard)
//   GET  /api/pipeline-profiles            → { profiles } (task/automation draft profileName guard)
//   POST /api/tasks | /api/pipeline-profiles | /api/custom-agents | /api/automations → confirm
//   POST /api/nl-chat/sessions/:id/cancel  → { cancelled: true }

function stubApi(opts: {
  chatSessionId?: string
  job?: any
  jobStates?: any[]
  turn?: any
  confirmOk?: boolean
  catalog?: any
  /** Response cho lần GET /api/catalog thứ n — phần tử `'fail'` trả 500. */
  catalogSeq?: any[]
  profiles?: any
  profilesFail?: boolean
  /** Response cho lần GET /api/pipeline-profiles thứ n — lần vượt quá dùng phần tử cuối. */
  profilesSeq?: any[]
}) {
  let jobCall = 0
  let profilesCall = 0
  let catalogCall = 0
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
      const seq = opts.catalogSeq
      const body = seq
        ? seq[Math.min(catalogCall, seq.length - 1)]
        : (opts.catalog ?? { skills: [], agents: [{ id: 'agent-a' }, { id: 'agent-b' }] })
      catalogCall += 1
      if (body === 'fail') return { ok: false, status: 500, json: async () => ({ error: 'boom' }) }
      return { ok: true, status: 200, json: async () => body }
    }
    if (url.includes('/api/pipeline-profiles') && method === 'GET') {
      if (opts.profilesFail) return { ok: false, status: 500, json: async () => ({ error: 'boom' }) }
      const seq = opts.profilesSeq
      const body = seq
        ? seq[Math.min(profilesCall, seq.length - 1)]
        : (opts.profiles ?? { profiles: [{ name: 'quality-first-pipeline' }] })
      profilesCall += 1
      return { ok: true, status: 200, json: async () => body }
    }
    if (url.includes('/api/jobs/') && method === 'GET') {
      const states = opts.jobStates ?? [{ id: 'jobZ', status: 'succeeded' }]
      const job = states[Math.min(jobCall, states.length - 1)]
      jobCall += 1
      return { ok: true, status: 200, json: async () => ({ job }) }
    }
    if (
      (url.includes('/api/tasks') ||
        url.includes('/api/pipeline-profiles') ||
        url.includes('/api/custom-agents') ||
        url.includes('/api/automations')) &&
      method === 'POST'
    ) {
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

  // T8ee57185: loadCatalog() (fired by a pipeline draft) used to call
  // GET /api/catalog with no `project` at all, so the agent-ref guard
  // checked against the registry's default project's catalog instead of
  // the session's actual project — forward `opts.getProjectId()` the same
  // way `PipelineEditor.vue`/`AgentEditor.vue` already do.
  it('a pipeline draft loads the catalog scoped to the session project', async () => {
    const fetchMock = stubApi({
      turn: { status: 'ready', kind: 'draft', entityType: 'pipeline', draft: { steps: [{ agent: 'agent-a' }] } },
    })
    const s = make({ getProjectId: () => 'proj-x' })
    await s.sendMessage('tạo pipeline')
    await new Promise((r) => setTimeout(r, 5))

    const catalogCall = fetchMock.mock.calls.find(([url]: any[]) => String(url).includes('/api/catalog'))
    expect(String(catalogCall?.[0])).toContain('project=proj-x')
  })

  it('a pipeline draft with no project selected still loads the catalog (back-compat)', async () => {
    const fetchMock = stubApi({
      turn: { status: 'ready', kind: 'draft', entityType: 'pipeline', draft: { steps: [{ agent: 'agent-a' }] } },
    })
    const s = make()
    await s.sendMessage('tạo pipeline')
    await new Promise((r) => setTimeout(r, 5))

    const catalogCall = fetchMock.mock.calls.find(([url]: any[]) => String(url).includes('/api/catalog'))
    expect(String(catalogCall?.[0])).not.toContain('project=')
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

  // T536c80fd: bỏ cache-một-lần-mỗi-phiên làm tổ hợp "set agent cũ vẫn còn +
  // lần nạp gần nhất hỏng" trở nên khả thi. Soát draft trên set cũ là để lọt
  // ref của agent vừa bị xoá — guard phải fail-closed theo `catalogError`.
  it('confirm(pipeline) chặn khi lần nạp catalog gần nhất hỏng, dù set cũ vẫn còn', async () => {
    stubApi({
      turn: { status: 'ready', kind: 'draft', entityType: 'pipeline', draft: { steps: [{ agent: 'agent-a' }] } },
      // Lần 1 (lúc nhận draft): OK. Lần 2 (lúc `confirm()` soát lại): hỏng.
      catalogSeq: [{ skills: [], agents: [{ id: 'agent-a' }] }, 'fail'],
      confirmOk: true,
    })
    const s = make()
    s.pipelineName.value = 'my-pipeline'
    await s.sendMessage('tạo pipeline')
    await new Promise((r) => setTimeout(r, 5))

    await s.confirm({ steps: [{ agent: 'agent-a' }] })

    expect(s.step.value).toBe('previewDraft')
    expect(s.error.value).toContain('Không tải được danh sách agent')
  })

  // Đối xứng với ca `profileName` ở dưới: agent tạo ở tab khác SAU lúc nhận
  // draft vẫn phải soát được ngay, không phải mở phiên chat mới (D4).
  it('agent tạo giữa phiên được chấp nhận ở lần soát của confirm()', async () => {
    stubApi({
      turn: { status: 'ready', kind: 'draft', entityType: 'pipeline', draft: { steps: [{ agent: 'agent-vua-tao' }] } },
      catalogSeq: [
        { skills: [], agents: [{ id: 'agent-a' }] },
        { skills: [], agents: [{ id: 'agent-a' }, { id: 'agent-vua-tao' }] },
      ],
      confirmOk: true,
    })
    const s = make()
    s.pipelineName.value = 'my-pipeline'
    await s.sendMessage('tạo pipeline')
    await new Promise((r) => setTimeout(r, 5))
    // Lúc nhận draft, catalog chưa có agent đó → ref bị coi là không hợp lệ.
    expect(s.findInvalidPipelineAgentRefs({ steps: [{ agent: 'agent-vua-tao' }] })).toEqual(['agent-vua-tao'])

    await s.confirm({ steps: [{ agent: 'agent-vua-tao' }] })

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

  // 202608_005: an `agent` draft saved via NL-chat used to fall back silently
  // to whatever project the server registry marks `default: true` when the
  // project context was missing — the actual root cause of "agent created
  // from dashboard can't be used" (job edb2c931..., saved to the wrong
  // project). `agentScope` makes the target explicit instead of trusting
  // `getProjectId()` alone.
  it('confirm(agent) blocks and errors when scope is "project" (default) but no project is selected', async () => {
    stubApi({ turn: { status: 'ready', kind: 'draft', entityType: 'agent', draft: { name: 'a' } } })
    const s = make()
    await s.sendMessage('tạo agent')
    expect(s.agentScope.value).toBe('project')

    await s.confirm({ name: 'a' })

    expect(s.step.value).toBe('previewDraft')
    expect(s.error.value).toMatch(/project/i)
  })

  it('confirm(agent) succeeds with scope "global" even when no project is selected', async () => {
    stubApi({ turn: { status: 'ready', kind: 'draft', entityType: 'agent', draft: { name: 'a' } }, confirmOk: true })
    const s = make()
    await s.sendMessage('tạo agent')
    s.agentScope.value = 'global'

    await s.confirm({ name: 'a' })

    expect(s.step.value).toBe('done')
  })

  it('confirm(agent) succeeds with scope "project" when a project is selected', async () => {
    stubApi({ turn: { status: 'ready', kind: 'draft', entityType: 'agent', draft: { name: 'a' } }, confirmOk: true })
    const s = make({ getProjectId: () => 'proj-x' })
    await s.sendMessage('tạo agent')

    await s.confirm({ name: 'a' })

    expect(s.step.value).toBe('done')
  })

  // ── Tf2fec630: draft automation + guard profileName ───────────────────────

  // Hồi quy G5: nhánh lọc cũ chỉ nhận task|pipeline|agent nên draft automation
  // bị chặn lại ở "chatting" kèm câu "chưa rõ", dù confirm() đã biết persist nó.
  it('an automation draft reaches previewDraft instead of being bounced back to chat', async () => {
    stubApi({
      turn: {
        status: 'ready',
        kind: 'draft',
        entityType: 'automation',
        draft: { name: 'r', triggers: [{ kind: 'event', eventType: 'job.failed' }], actions: [] },
      },
    })
    const s = make()
    await s.sendMessage('tạo rule chạy lại khi job fail')

    expect(s.step.value).toBe('previewDraft')
    expect(s.entityType.value).toBe('automation')
  })

  it('confirm(task) blocks when profileName is not an existing pipeline profile', async () => {
    const fetchMock = stubApi({
      turn: { status: 'ready', kind: 'draft', entityType: 'task', draft: { taskId: 't1', prompt: 'p', profileName: 'khong-ton-tai' } },
    })
    const s = make()
    await s.sendMessage('tạo task dùng pipeline khong-ton-tai')
    await new Promise((r) => setTimeout(r, 5))

    await s.confirm({ taskId: 't1', prompt: 'p', profileName: 'khong-ton-tai' })

    expect(s.step.value).toBe('previewDraft')
    expect(s.error.value).toContain('Pipeline profile không tồn tại')
    expect(s.error.value).toContain('khong-ton-tai')
    const created = fetchMock.mock.calls.some(
      ([url, init]: any[]) => String(url).includes('/api/tasks') && (init?.method || 'GET').toUpperCase() === 'POST',
    )
    expect(created).toBe(false)
  })

  it('confirm(task) goes through when profileName matches a real pipeline profile', async () => {
    stubApi({
      turn: { status: 'ready', kind: 'draft', entityType: 'task', draft: { taskId: 't1', prompt: 'p', profileName: 'quality-first-pipeline' } },
      confirmOk: true,
    })
    const s = make()
    await s.sendMessage('m')
    await new Promise((r) => setTimeout(r, 5))

    await s.confirm({ taskId: 't1', prompt: 'p', profileName: 'quality-first-pipeline' })

    expect(s.step.value).toBe('done')
    expect(s.error.value).toBeNull()
  })

  // E8: draft không chỉ định pipeline thì không có gì để soát — không được
  // fail-closed oan.
  it('a task draft without profileName confirms without being blocked', async () => {
    stubApi({
      turn: { status: 'ready', kind: 'draft', entityType: 'task', draft: { taskId: 't1', prompt: 'p' } },
      confirmOk: true,
    })
    const s = make()
    await s.sendMessage('m')
    await new Promise((r) => setTimeout(r, 5))

    await s.confirm({ taskId: 't1', prompt: 'p' })

    expect(s.step.value).toBe('done')
    expect(s.error.value).toBeNull()
  })

  // Hồi quy: danh sách profile được nạp theo LOẠI draft, không theo nội dung
  // draft lúc nhận. Nạp có điều kiện thì người dùng tự thêm `profileName` vào
  // textarea preview sẽ kẹt vĩnh viễn ở "đang kiểm tra" → nút Xác nhận disabled
  // → không còn chỗ nào nạp danh sách nữa.
  it('a task draft without profileName still loads the profile list, so a hand-typed profileName is checkable', async () => {
    stubApi({
      turn: { status: 'ready', kind: 'draft', entityType: 'task', draft: { taskId: 't1', prompt: 'p' } },
      confirmOk: true,
    })
    const s = make()
    await s.sendMessage('m')
    await new Promise((r) => setTimeout(r, 5))

    // Người dùng gõ thêm một profile CÓ THẬT vào draft đang xem.
    const edited = { taskId: 't1', prompt: 'p', profileName: 'quality-first-pipeline' }
    expect(s.profileNameError(edited, 'task')).toBeNull()

    await s.confirm(edited)
    expect(s.step.value).toBe('done')
    expect(s.error.value).toBeNull()
  })

  it('confirm(automation) blocks when an actions[].profileName does not exist', async () => {
    const draft = {
      name: 'r',
      triggers: [{ kind: 'event', eventType: 'job.failed' }],
      actions: [{ kind: 'runTask', mode: 'create', prompt: 'p', profileName: 'ma-khong-co' }],
    }
    const fetchMock = stubApi({ turn: { status: 'ready', kind: 'draft', entityType: 'automation', draft } })
    const s = make()
    await s.sendMessage('m')
    await new Promise((r) => setTimeout(r, 5))

    await s.confirm(draft)

    expect(s.step.value).toBe('previewDraft')
    expect(s.error.value).toContain('ma-khong-co')
    const created = fetchMock.mock.calls.some(
      ([url, init]: any[]) => String(url).includes('/api/automations') && (init?.method || 'GET').toUpperCase() === 'POST',
    )
    expect(created).toBe(false)
  })

  // E10: fail closed — rơi về pipeline mặc định âm thầm chính là bug đang sửa.
  it('confirm(task) blocks when the profile list cannot be loaded', async () => {
    const draft = { taskId: 't1', prompt: 'p', profileName: 'quality-first-pipeline' }
    stubApi({ turn: { status: 'ready', kind: 'draft', entityType: 'task', draft }, profilesFail: true })
    const s = make()
    await s.sendMessage('m')
    await new Promise((r) => setTimeout(r, 5))

    await s.confirm(draft)

    expect(s.step.value).toBe('previewDraft')
    expect(s.error.value).toContain('Không tải được danh sách pipeline profile')
  })

  // T536c80fd D4: guard FE cũng đóng băng theo phiên — agent thấy pipeline mới
  // nhưng nút "Xác nhận" vẫn báo "Pipeline profile không tồn tại".
  function profilesGets(fetchMock: any): any[] {
    return fetchMock.mock.calls.filter(
      ([url, init]: any[]) =>
        String(url).includes('/api/pipeline-profiles') && (init?.method || 'GET').toUpperCase() === 'GET',
    )
  }

  it('draft thứ hai trong cùng phiên nạp lại danh sách pipeline profile', async () => {
    const draft = { taskId: 't1', prompt: 'p', profileName: 'quality-first-pipeline' }
    const fetchMock = stubApi({ turn: { status: 'ready', kind: 'draft', entityType: 'task', draft } })
    const s = make()

    await s.sendMessage('m')
    await new Promise((r) => setTimeout(r, 5))
    expect(profilesGets(fetchMock).length).toBe(1)

    await s.sendMessage('m2')
    await new Promise((r) => setTimeout(r, 5))
    expect(profilesGets(fetchMock).length).toBe(2)
  })

  it('pipeline tạo giữa phiên được chấp nhận ở lần soát sau, không cần mở phiên mới', async () => {
    const draft = { taskId: 't1', prompt: 'p', profileName: 'pipeline-vua-tao' }
    stubApi({
      turn: { status: 'ready', kind: 'draft', entityType: 'task', draft },
      // Lần 1: chưa có. Lần 2 (người dùng vừa tạo ở tab khác): đã có.
      profilesSeq: [
        { profiles: [{ name: 'quality-first-pipeline' }] },
        { profiles: [{ name: 'quality-first-pipeline' }, { name: 'pipeline-vua-tao' }] },
      ],
    })
    const s = make()

    await s.sendMessage('m')
    await new Promise((r) => setTimeout(r, 5))
    expect(s.profileNameError(draft, 'task')).toContain('pipeline-vua-tao')

    // `confirm()` nạp lại trước khi soát → thấy profile mới, đi tiếp.
    await s.confirm(draft)
    expect(s.profileNameError(draft, 'task')).toBeNull()
    expect(s.step.value).not.toBe('previewDraft')
  })

  it('hai lời gọi chồng nhau chỉ bắn một request pipeline-profiles', async () => {
    const draft = { taskId: 't1', prompt: 'p', profileName: 'quality-first-pipeline' }
    const fetchMock = stubApi({ turn: { status: 'ready', kind: 'draft', entityType: 'task', draft } })
    const s = make()

    // Đúng chuỗi thao tác thật: draft về → `sendMessage` bắn `loadProfiles()`
    // KHÔNG await → người dùng bấm "Xác nhận" ngay, `confirm()` gọi lần hai
    // khi request đầu còn đang bay. Không có `setTimeout` xen giữa, nếu không
    // request đầu đã xong và đây không còn là ca chồng nhau.
    await s.sendMessage('m')
    expect(s.entityType.value).toBe('task')
    await s.confirm(draft)
    await new Promise((r) => setTimeout(r, 5))

    expect(profilesGets(fetchMock).length).toBe(1)
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

// ── T9942d974 — sửa draft bằng chat (test-spec.md §6, TC-C1…TC-C12) ─────────
// Lỗ hổng mà nhóm này lấp: chưa case nào gửi message khi đang ở `previewDraft`.
// Stub riêng vì `stubApi` ở trên chỉ trả được MỘT `turn` cho mọi lượt, còn ở đây
// lượt hai phải khác lượt một (draft A → draft B).

interface SeqCtl {
  /** Turn trả về cho lượt thứ n; vượt quá thì dùng phần tử cuối. */
  turns: any[]
  turnIndex: number
  /** true ⇒ lượt gửi kế tiếp ném lỗi mạng. */
  failSend: boolean
}

function stubSeq(turns: any[]) {
  const ctl: SeqCtl = { turns, turnIndex: 0, failSend: false }
  /** Body JSON của từng POST tới /api/nl-chat (start + messages), theo thứ tự. */
  const sent: Record<string, any>[] = []
  const fetchMock = vi.fn(async (input: any, init: any = {}) => {
    const url = String(input)
    const method = (init.method || 'GET').toUpperCase()
    if (url.includes('/api/nl-chat/sessions') && method === 'POST') {
      if (ctl.failSend) throw new Error('mạng hỏng')
      sent.push(JSON.parse(String(init.body ?? '{}')))
      return {
        ok: true,
        status: 201,
        json: async () => ({ chatSessionId: 'nlchat-abc', job: { id: 'jobZ', status: 'queued' } }),
      }
    }
    if (url.includes('/api/nl-chat/sessions/') && method === 'GET') {
      const turn = ctl.turns[Math.min(ctl.turnIndex, ctl.turns.length - 1)]
      ctl.turnIndex += 1
      return { ok: true, status: 200, json: async () => turn }
    }
    if (url.includes('/api/jobs/') && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ job: { id: 'jobZ', status: 'succeeded' } }) }
    }
    if (url.includes('/api/pipeline-profiles') && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ profiles: [{ name: 'rev' }] }) }
    }
    if (url.includes('/api/tasks') && method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    }
    throw new Error(`unexpected fetch: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { ctl, sent, fetchMock }
}

function draftTurn(draft: Record<string, unknown>) {
  return { status: 'ready', kind: 'draft', entityType: 'task', draft }
}

describe('useNlChatSession — sửa draft bằng chat (T9942d974)', () => {
  it('TC-C1: lỗi một lượt chat KHÔNG cướp màn preview', async () => {
    const { ctl } = stubSeq([draftTurn({ name: 'a', prompt: 'p' })])
    const s = make()
    await s.sendMessage('m')
    const A = s.draft.value
    expect(s.step.value).toBe('previewDraft')

    ctl.failSend = true
    await s.sendMessage('đổi tên')

    expect(s.step.value).toBe('previewDraft')
    expect(s.draft.value).toBe(A)
    expect(s.error.value).not.toBeNull()
    expect(s.sending.value).toBe(false)
  })

  it('TC-C2 (không hồi quy): lỗi khi đang chatting vẫn rơi về error', async () => {
    const { ctl } = stubSeq([{ status: 'ready', kind: 'question', text: '?' }])
    const s = make()
    ctl.failSend = true
    await s.sendMessage('m')

    expect(s.step.value).toBe('error')
    expect(s.error.value).not.toBeNull()
  })

  it('TC-C3: body mang draft đang sửa, bong bóng chat KHÔNG mang JSON', async () => {
    const { sent } = stubSeq([
      draftTurn({ name: 'a', prompt: 'p' }),
      { status: 'ready', kind: 'question', text: 'ok' },
    ])
    const s = make()
    await s.sendMessage('m')
    await s.sendMessage('đổi tên thành X')

    const body = sent[sent.length - 1]
    expect(body.message).toContain('đổi tên thành X')
    expect(body.message).toContain('"name": "a"')
    expect(s.messages.value[s.messages.value.length - 2]).toEqual({
      role: 'user',
      text: 'đổi tên thành X',
    })
  })

  it('TC-C4a: vượt ngưỡng ⇒ gửi trần + cảnh báo', async () => {
    const { sent } = stubSeq([
      draftTurn({ prompt: 'x'.repeat(25_000) }),
      { status: 'ready', kind: 'question', text: 'ok' },
    ])
    const s = make()
    await s.sendMessage('m')
    await s.sendMessage('sửa')

    expect(sent[sent.length - 1].message).toBe('sửa')
    expect(s.draftAttachWarning.value).toBe(true)
  })

  it('TC-C4b: cảnh báo được dọn ở đầu lượt gửi kế tiếp', async () => {
    const { sent } = stubSeq([
      draftTurn({ prompt: 'x'.repeat(25_000) }),
      { status: 'ready', kind: 'question', text: 'ok' },
    ])
    const s = make()
    await s.sendMessage('m')
    await s.sendMessage('sửa')
    expect(s.draftAttachWarning.value).toBe(true)

    s.setDraft({ prompt: 'ngắn' })
    await s.sendMessage('sửa')

    expect(s.draftAttachWarning.value).toBe(false)
    expect(sent[sent.length - 1].message).toContain('```json')
  })

  it('TC-C5a: turn draft thứ hai ⇒ banner + snapshot', async () => {
    const A = { name: 'a', prompt: 'p' }
    const B = { name: 'b', prompt: 'p' }
    stubSeq([draftTurn(A), draftTurn(B)])
    const s = make()
    await s.sendMessage('m')
    await s.sendMessage('đổi tên thành b')

    expect(s.draft.value).toEqual(B)
    expect(s.draftUpdatedByChat.value).toBe(true)
    expect(s.draftSnapshot.value).toEqual(A)
    expect(s.step.value).toBe('previewDraft')
  })

  it('TC-C5b: undoDraftUpdate() khôi phục bản trước', async () => {
    const A = { name: 'a', prompt: 'p' }
    stubSeq([draftTurn(A), draftTurn({ name: 'b', prompt: 'p' })])
    const s = make()
    await s.sendMessage('m')
    await s.sendMessage('đổi tên thành b')
    s.undoDraftUpdate()

    expect(s.draft.value).toEqual(A)
    expect(s.draftUpdatedByChat.value).toBe(false)
    expect(s.draftSnapshot.value).toBeNull()
  })

  it('TC-C5c: hoàn tác lần hai là no-op, không lùi tiếp', async () => {
    const A = { name: 'a', prompt: 'p' }
    stubSeq([draftTurn(A), draftTurn({ name: 'b', prompt: 'p' })])
    const s = make()
    await s.sendMessage('m')
    await s.sendMessage('đổi tên thành b')
    s.undoDraftUpdate()
    expect(() => s.undoDraftUpdate()).not.toThrow()

    expect(s.draft.value).toEqual(A)
  })

  it('TC-C6: draft ĐẦU TIÊN của phiên ⇒ không có gì để hoàn tác', async () => {
    const A = { name: 'a', prompt: 'p' }
    stubSeq([draftTurn(A)])
    const s = make()
    await s.sendMessage('m')

    expect(s.step.value).toBe('previewDraft')
    expect(s.draft.value).toEqual(A)
    expect(s.draftUpdatedByChat.value).toBe(false)
    expect(s.draftSnapshot.value).toBeNull()
  })

  it('TC-C7: agent hỏi lại khi đang preview ⇒ giữ draft, không để snapshot mồ côi', async () => {
    stubSeq([
      draftTurn({ name: 'a', prompt: 'p' }),
      { status: 'ready', kind: 'question', text: 'bạn muốn đổi gì?' },
    ])
    const s = make()
    await s.sendMessage('m')
    const A = s.draft.value
    await s.sendMessage('hỏi lại đi')

    expect(s.step.value).toBe('previewDraft')
    expect(s.draft.value).toBe(A)
    expect(s.messages.value[s.messages.value.length - 1]).toEqual({
      role: 'assistant',
      text: 'bạn muốn đổi gì?',
    })
    expect(s.draftSnapshot.value).toBeNull()
  })

  it('TC-C8: reset() dọn đủ 4 state mới', async () => {
    stubSeq([draftTurn({ name: 'a', prompt: 'p' })])
    const s = make()
    await s.sendMessage('m')
    // Bốn cờ không cùng bẩn được qua một luồng thật (`setDraft` gỡ banner,
    // turn draft dọn `draftDirty`) nên đặt thẳng — đây là test của `reset()`.
    s.draftSnapshot.value = { name: 'cũ' }
    s.draftUpdatedByChat.value = true
    s.draftDirty.value = true
    s.draftAttachWarning.value = true

    s.reset()

    expect(s.draftSnapshot.value).toBeNull()
    expect(s.draftUpdatedByChat.value).toBe(false)
    expect(s.draftDirty.value).toBe(false)
    expect(s.draftAttachWarning.value).toBe(false)
  })

  it('TC-C9: chỉnh tay khi banner đang hiện ⇒ banner tắt, snapshot bỏ', async () => {
    stubSeq([draftTurn({ name: 'a', prompt: 'p' }), draftTurn({ name: 'b', prompt: 'p' })])
    const s = make()
    await s.sendMessage('m')
    await s.sendMessage('đổi tên thành b')

    const C = { name: 'c', prompt: 'p' }
    s.setDraft(C)

    expect(s.draft.value).toBe(C)
    expect(s.draftDirty.value).toBe(true)
    expect(s.draftUpdatedByChat.value).toBe(false)
    expect(s.draftSnapshot.value).toBeNull()
  })

  it('TC-C10: dismissDraftUpdate() bỏ banner mà GIỮ draft mới', async () => {
    const B = { name: 'b', prompt: 'p' }
    stubSeq([draftTurn({ name: 'a', prompt: 'p' }), draftTurn(B)])
    const s = make()
    await s.sendMessage('m')
    await s.sendMessage('đổi tên thành b')
    s.dismissDraftUpdate()

    expect(s.draft.value).toEqual(B)
    expect(s.draftUpdatedByChat.value).toBe(false)
    expect(s.draftSnapshot.value).toBeNull()
  })

  it('TC-C11 (không hồi quy): guard message rỗng', async () => {
    const { sent } = stubSeq([draftTurn({ name: 'a', prompt: 'p' })])
    const s = make()
    await s.sendMessage('m')
    const before = sent.length
    const messagesBefore = [...s.messages.value]

    await s.sendMessage('')
    await s.sendMessage('   ')

    expect(sent.length).toBe(before)
    expect(s.messages.value).toEqual(messagesBefore)
    expect(s.draftSnapshot.value).toBeNull()
  })

  it('TC-C12: đang sending thì lượt thứ hai bị bỏ qua', async () => {
    const { sent } = stubSeq([draftTurn({ name: 'a', prompt: 'p' })])
    const s = make()

    const first = s.sendMessage('a')
    await s.sendMessage('b')
    await first

    expect(sent).toHaveLength(1)
    expect(s.messages.value.filter((m) => m.role === 'user')).toHaveLength(1)
  })
})
