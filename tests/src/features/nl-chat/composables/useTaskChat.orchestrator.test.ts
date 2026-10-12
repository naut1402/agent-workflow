import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/frontend/lib/dashboardTransport', () => ({
  ensureDashboardTransport: vi.fn().mockResolvedValue('polling'),
  isSseEnabled: (t: string) => t !== 'polling',
}))

import { useTaskChat } from '@/features/nl-chat/composables/useTaskChat'
import { setI18nLocale } from '@/frontend/plugins/i18n'
import { ORCHESTRATOR_STEP_ID } from '@/shared/lib/orchestrator'
import { localeMessages } from '../../../helpers/localeYaml'

/*
 * Ted0cf9ac — nhóm G (D3 FE): panel của nút điều phối khi chạy song song.
 *
 * Bề mặt chấm: state công khai của `useTaskChat` (`canSend`, `queued`,
 * `blockedText`, `pending`, `error`, `turns`) — đúng thứ panel render.
 * Server được giả lập ở tầng `fetch`:
 *   GET  /api/tasks/:id/chat?stepId=__orchestrator__ → state của panel
 *   POST /api/tasks/:id/feedback                    → 201 { queued: true } khi nút bận
 */

const VI_QUEUED_ORCH = 'Nút điều phối đang xử lý — tin nhắn sẽ được gửi khi lượt hiện tại xong.'
const EN_QUEUED_ORCH = 'The orchestrator is busy — your message will be sent when the current turn finishes.'
const VI_QUEUED_STEP = 'Tin nhắn mới sẽ được gửi khi step hiện tại hoàn tất.'
const VI_STEP_BUSY = 'Step đang chạy — chờ chạy xong mới gửi được tin nhắn.'

interface SendReply {
  status: number
  body: any
}

function stubApi(states: any[], reply: SendReply = { status: 201, body: { job: { id: 'o1' } } }) {
  let call = 0
  const posted: any[] = []
  const fetchMock = vi.fn(async (input: any, init: any = {}) => {
    const url = String(input)
    const method = (init.method || 'GET').toUpperCase()
    if (url.includes('/feedback') && method === 'POST') {
      posted.push(JSON.parse(init.body))
      return { ok: reply.status < 400, status: reply.status, json: async () => reply.body }
    }
    if (url.includes('/chat')) {
      const state = states[Math.min(call, states.length - 1)]
      call += 1
      return { ok: true, status: 200, json: async () => structuredClone(state) }
    }
    throw new Error(`unexpected fetch: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, posted }
}

function make(stepId = ORCHESTRATOR_STEP_ID) {
  return useTaskChat({
    getTaskId: () => 'T-ORCH',
    getStepId: () => stepId,
    getProjectId: () => 'P1',
  })
}

const BASE = {
  taskId: 'T-ORCH',
  stepId: ORCHESTRATOR_STEP_ID,
  sessionId: 's-orch',
  transcriptFound: true,
  turns: [{ index: 1, role: 'assistant', text: 'Pipeline đang chạy investigate.' }],
  total: 2,
  canSend: true,
}

/** Nút rảnh: server KHÔNG báo running/queued cho panel nút dù step đang chạy. */
const ORCH_IDLE = { ...BASE, running: null, queued: false }
/** Nút đang chạy một lượt của chính nó. */
const ORCH_BUSY = {
  ...BASE,
  running: { jobId: 'o1', stepId: ORCHESTRATOR_STEP_ID, startedAt: '2026-10-12T00:00:00.000Z' },
  queued: true,
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setI18nLocale('vi')
})

describe('TC-34 — panel nút điều phối khi chỉ step đang chạy', () => {
  it('ô nhập bật, không có text gợi ý "đợi step", gửi được và không báo lỗi', async () => {
    const { posted } = stubApi([ORCH_IDLE])
    const c = make()
    await c.refresh(false)
    expect(c.canSend.value).toBe(true)
    expect(c.queued.value).toBe(false)
    expect(c.blockedText.value).toBeNull()

    await c.send('M1')
    expect(posted[0]).toMatchObject({ feedback: 'M1', stepId: ORCHESTRATOR_STEP_ID })
    expect(c.error.value).toBeNull()
  })
})

describe('TC-35/TC-37 — text gợi ý riêng khi nút điều phối bận', () => {
  it('vi: text riêng của nút điều phối, khác text của panel step; vẫn cho gửi', async () => {
    stubApi([ORCH_BUSY])
    const c = make()
    await c.refresh(false)
    expect(c.canSend.value).toBe(true)
    expect(c.blockedText.value).toBe(VI_QUEUED_ORCH)
    expect(c.blockedText.value).not.toBe(VI_QUEUED_STEP)
  })

  it('en: text tiếng Anh riêng, không phải key thô hay fallback tiếng Việt', async () => {
    setI18nLocale('en')
    stubApi([ORCH_BUSY])
    const c = make()
    await c.refresh(false)
    expect(c.blockedText.value).toBe(EN_QUEUED_ORCH)
    expect(c.blockedText.value).not.toContain('nlChat.')
  })

  it('hai file locale cùng có key queuedOrchestrator và cùng tập key taskChat', () => {
    const vi_ = localeMessages('vi', 'nlChat')
    const en = localeMessages('en', 'nlChat')
    expect(String(vi_.taskChat.queuedOrchestrator).trim()).not.toBe('')
    expect(String(en.taskChat.queuedOrchestrator).trim()).not.toBe('')
    expect(Object.keys(en.taskChat).sort()).toEqual(Object.keys(vi_.taskChat).sort())
  })
})

describe('TC-36 — gửi khi bận hiện tin nhắn chờ, không như lỗi', () => {
  it('M1, M2 nhận { queued: true } ⇒ hiện chờ theo thứ tự, không lỗi; transcript có hội thoại thật ⇒ bản chờ biến mất', async () => {
    const withReplies = {
      ...ORCH_BUSY,
      running: null,
      queued: false,
      turns: [
        ...BASE.turns,
        { index: 2, role: 'user', text: 'M1\n\nM2' },
        { index: 3, role: 'assistant', text: 'Đã nhận M1 và M2.' },
      ],
      total: 4,
    }
    stubApi([ORCH_BUSY, ORCH_BUSY, ORCH_BUSY, withReplies], { status: 201, body: { queued: true } })
    const c = make()
    await c.refresh(false)

    await c.send('M1')
    await c.send('M2')
    expect(c.error.value).toBeNull()
    expect(c.pending.value).toEqual(['M1', 'M2'])

    await c.refresh(true)
    expect(c.pending.value).toEqual([])
    expect(c.turns.value.some((t) => t.text === 'Đã nhận M1 và M2.')).toBe(true)
  })

  it('409 trên panel nút điều phối ⇒ hiện message của server, KHÔNG phải "step đang chạy"', async () => {
    stubApi([ORCH_IDLE], { status: 409, body: { error: 'orchestrator is not active for this task' } })
    const c = make()
    await c.refresh(false)
    await c.send('M1')
    expect(c.error.value).not.toBe(VI_STEP_BUSY)
    expect(c.error.value).toContain('orchestrator is not active')
  })
})

describe('TC-38 — panel step không đổi hành vi', () => {
  it('step đang chạy ⇒ text "queued" của step', async () => {
    stubApi([{ ...BASE, stepId: 'design', canSend: true, queued: true, running: { jobId: 's1', stepId: 'design' } }])
    const c = make('design')
    await c.refresh(false)
    expect(c.blockedText.value).toBe(VI_QUEUED_STEP)
  })

  it('409 trên panel step ⇒ vẫn là "step đang chạy"', async () => {
    stubApi([{ ...BASE, stepId: 'design', running: null }], { status: 409, body: { error: 'step already running' } })
    const c = make('design')
    await c.refresh(false)
    await c.send('F1')
    expect(c.error.value).toBe(VI_STEP_BUSY)
  })
})

describe('TC-39 — reload trang khi đang có tin nhắn chờ', () => {
  it('mở lại panel: không lỗi; khi lượt chat gộp xong thì câu trả lời hiện lên', async () => {
    const answered = {
      ...ORCH_IDLE,
      turns: [...BASE.turns, { index: 2, role: 'user', text: 'M1' }, { index: 3, role: 'assistant', text: 'Trả lời M1.' }],
      total: 4,
    }
    stubApi([ORCH_BUSY, answered])
    // Composable mới = panel vừa mount lại sau reload: không còn echo cục bộ.
    const c = make()
    await c.refresh(false)
    expect(c.error.value).toBeNull()
    expect(c.blockedText.value).toBe(VI_QUEUED_ORCH)

    await c.refresh(false)
    expect(c.error.value).toBeNull()
    expect(c.turns.value.map((t) => t.text)).toContain('Trả lời M1.')
  })
})
