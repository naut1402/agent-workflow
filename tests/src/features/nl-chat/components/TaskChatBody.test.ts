import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTestI18nPlugin, mountWithI18n } from '../../../helpers/i18n'

// `useTaskChat().start()` reads the transport flag before doing anything else
// (Tfe0c91ca — SSE migration). This file pins REST-poll response handling
// (`stubChat` only understands `/chat`, not `/chat/stream`) — force 'polling'
// so the underlying composable keeps taking the REST branch these cases
// actually exercise.
vi.mock('@/frontend/lib/dashboardTransport', () => ({
  ensureDashboardTransport: vi.fn().mockResolvedValue('polling'),
  isSseEnabled: (t: string) => t !== 'polling',
}))

import TaskChatBody from '@/features/nl-chat/components/TaskChatBody.vue'

/**
 * The four mutually exclusive "nothing to show" reasons used to be a
 * `v-if`/`v-else-if` chain in the template; they are now the `emptyHint`
 * computed. Same branches, so the same four cases have to keep producing the
 * same line — that is what this file pins.
 */

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

function stubChat(state: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any) => {
      const url = String(input)
      if (url.includes('/chat')) {
        return { ok: true, status: 200, json: async () => structuredClone(state) }
      }
      throw new Error(`unexpected fetch: ${url}`)
    }),
  )
}

/** Mounted bodies keep a poll timer alive until unmounted — track and tear down. */
const mounted: { unmount: () => void }[] = []

async function mountBody(state: Record<string, unknown>) {
  stubChat(state)
  // `active` must be passed explicitly: Vue casts an absent Boolean prop to
  // `false`, never `undefined`, so omitting it means "minimized" and the body
  // never starts polling. `ChatWindow` always binds it in production.
  const wrapper = mountWithI18n(TaskChatBody, {
    props: { taskId: 'DEMO-1', stepId: 'design', projectId: 'P1', active: true },
  })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
  vi.unstubAllGlobals()
})

describe('TaskChatBody — empty-state hint', () => {
  it('no CLI session yet points at running the step first', async () => {
    const wrapper = await mountBody({ ...READY, sessionId: '', turns: [], total: 0 })
    expect(wrapper.find('.nl-chat-hint').text()).toContain('chưa có phiên CLI nào')
  })

  it('a session whose transcript is missing reports the server reason verbatim', async () => {
    const wrapper = await mountBody({
      ...READY,
      transcriptFound: false,
      transcriptMissingReason: 'Transcript nằm trên máy khác',
      turns: [],
      total: 0,
    })
    expect(wrapper.find('.nl-chat-hint').text()).toBe('Transcript nằm trên máy khác')
  })

  it('a missing transcript with no reason still names the session', async () => {
    const wrapper = await mountBody({
      ...READY,
      transcriptFound: false,
      turns: [],
      total: 0,
    })
    const text = wrapper.find('.nl-chat-hint').text()
    expect(text).toContain('Không tìm thấy transcript')
    expect(text).toContain('s1')
  })

  it('a found-but-empty transcript says the session has no content', async () => {
    const wrapper = await mountBody({ ...READY, turns: [], total: 0 })
    expect(wrapper.find('.nl-chat-hint').text()).toContain('chưa có nội dung hội thoại')
  })

  it('no session AND no transcript reports the missing session, not the transcript', async () => {
    // Both flags are "bad" at once. The old template chain resolved this to the
    // session message because its transcript branch required a session id, so the
    // session check has to stay first.
    const wrapper = await mountBody({
      ...READY,
      sessionId: '',
      transcriptFound: false,
      transcriptMissingReason: 'không nên thấy dòng này',
      turns: [],
      total: 0,
    })
    expect(wrapper.find('.nl-chat-hint').text()).toContain('chưa có phiên CLI nào')
  })

  it('turns present means no hint, even when the transcript is flagged missing', async () => {
    // The old chain gated every empty-state branch on "zero turns"; the early
    // return out of `emptyHint` is what preserves that.
    const wrapper = await mountBody({ ...READY, transcriptFound: false })
    expect(wrapper.find('.nl-chat-hint').exists()).toBe(false)
    expect(wrapper.findAll('.nl-chat-row')).toHaveLength(2)
  })
})

describe('TaskChatBody — turn labelling', () => {
  it('user and runner turns are labelled apart', async () => {
    const wrapper = await mountBody(READY)
    const roles = wrapper.findAll('.nl-chat-role').map((n) => n.text())
    expect(roles).toEqual(['Bạn', 'Runner'])
  })

  it('a tool turn renders as activity, not as a chat bubble', async () => {
    const wrapper = await mountBody({
      ...READY,
      turns: [{ index: 0, role: 'tool', tool: 'Read', text: 'design.md' }],
      total: 1,
    })
    expect(wrapper.find('.task-chat-tool').text()).toBe('Read')
    expect(wrapper.find('.task-chat-tool-arg').text()).toBe('design.md')
    expect(wrapper.find('.nl-chat-row').exists()).toBe(false)
  })
})

/**
 * Characterization của đợt i18n hoá: bản `vi` phải trùng từng ký tự chuỗi cứng trước
 * thay đổi, nên các hằng dưới đây chép từ `TaskChatBody.vue` / `useTaskChat.ts` bản
 * trước migrate, không chép từ `nlChat.yaml`.
 */
const VI_BEFORE = {
  roleUser: 'Bạn',
  roleUserPending: 'Bạn · đang gửi',
  roleRunner: 'Runner',
  noSession: 'Step này chưa có phiên CLI nào — chạy step trước rồi quay lại đây.',
  transcriptMissing: (id: string) => `Không tìm thấy transcript của phiên ${id} trên máy này.`,
  emptySession: 'Phiên chưa có nội dung hội thoại nào.',
  inputPlaceholder: 'Nhập tin nhắn cho runner…',
  cannotSend: 'Chưa gửi được',
  noCompletedJob: 'Chưa có job nào hoàn tất cho task này để nối tiếp hội thoại.',
  queued: 'Tin nhắn mới sẽ được gửi khi step hiện tại hoàn tất.',
  stepBusy: 'Step đang chạy — chờ chạy xong mới gửi được tin nhắn.',
  ready: 'Sẵn sàng',
  sending: 'Đang gửi…',
  running: 'Runner đang chạy',
  runningStep: (step: string) => `Runner đang chạy: ${step}`,
  error: (msg: string) => `Có lỗi: ${msg}`,
  stale: (reason: string) =>
    `Phiên đã cũ (${reason}) — tin nhắn mới có thể mở phiên khác, agent sẽ không nhớ ngữ cảnh trước.`,
}

type FeedbackReply = { status: number; body?: unknown }

/** Như `stubChat`, kèm `/feedback` trả về `feedback` (mặc định 200). */
function stubChatWithFeedback(state: Record<string, unknown>, feedback: FeedbackReply = { status: 200 }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any) => {
      const url = String(input)
      if (url.includes('/feedback')) {
        return { ok: feedback.status < 400, status: feedback.status, json: async () => feedback.body ?? {} }
      }
      if (url.includes('/chat')) {
        return { ok: true, status: 200, json: async () => structuredClone(state) }
      }
      throw new Error(`unexpected fetch: ${url}`)
    }),
  )
}

async function mountAt(locale: 'vi' | 'en', state: Record<string, unknown>, feedback?: FeedbackReply) {
  stubChatWithFeedback(state, feedback)
  const wrapper = mount(TaskChatBody, {
    props: { taskId: 'DEMO-1', stepId: 'design', projectId: 'P1', active: true },
    global: { plugins: [createTestI18nPlugin(locale)] },
  })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

type Mounted = Awaited<ReturnType<typeof mountAt>>

function statusTexts(wrapper: Mounted): string[] {
  return (wrapper.emitted('status') ?? []).map((e) => (e[0] as { text: string }).text)
}

function lastStatus(wrapper: Mounted): { kind: string; text: string } | null {
  const all = wrapper.emitted('status') ?? []
  return (all[all.length - 1]?.[0] ?? null) as { kind: string; text: string } | null
}

async function sendText(wrapper: Mounted, text: string): Promise<void> {
  await wrapper.find('textarea').setValue(text)
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}

describe('TaskChatBody — chuỗi đã i18n hoá', () => {
  it('bản `vi` của các hint trống giống HỆT chuỗi cứng cũ', async () => {
    const noSession = await mountAt('vi', { ...READY, sessionId: '', turns: [], total: 0 })
    expect(noSession.find('.nl-chat-hint').text()).toBe(VI_BEFORE.noSession)

    const missing = await mountAt('vi', { ...READY, transcriptFound: false, turns: [], total: 0 })
    expect(missing.find('.nl-chat-hint').text()).toBe(VI_BEFORE.transcriptMissing('s1'))

    const empty = await mountAt('vi', { ...READY, turns: [], total: 0 })
    expect(empty.find('.nl-chat-hint').text()).toBe(VI_BEFORE.emptySession)
  })

  it('bản `vi` của nhãn vai, placeholder và trạng thái giống HỆT chuỗi cứng cũ', async () => {
    const w = await mountAt('vi', READY)
    expect(w.findAll('.nl-chat-role').map((n) => n.text())).toEqual([VI_BEFORE.roleUser, VI_BEFORE.roleRunner])
    expect(w.find('textarea').attributes('placeholder')).toBe(VI_BEFORE.inputPlaceholder)
    expect(lastStatus(w)).toEqual({ kind: 'idle', text: VI_BEFORE.ready })

    const blocked = await mountAt('vi', { ...READY, canSend: false })
    expect(blocked.find('textarea').attributes('placeholder')).toBe(VI_BEFORE.cannotSend)
    expect(lastStatus(blocked)).toEqual({ kind: 'idle', text: VI_BEFORE.cannotSend })

    const noJob = await mountAt('vi', { ...READY, canSend: false, blockedReason: 'noCompletedJob' })
    expect(noJob.find('textarea').attributes('placeholder')).toBe(VI_BEFORE.noCompletedJob)

    const queued = await mountAt('vi', { ...READY, queued: true })
    expect(queued.find('textarea').attributes('placeholder')).toBe(VI_BEFORE.queued)

    const runStep = await mountAt('vi', { ...READY, running: { jobId: 'j1', stepId: 'design' } })
    expect(lastStatus(runStep)).toEqual({ kind: 'busy', text: VI_BEFORE.runningStep('design') })

    const run = await mountAt('vi', { ...READY, running: { jobId: 'j1' } })
    expect(lastStatus(run)).toEqual({ kind: 'busy', text: VI_BEFORE.running })

    const stale = await mountAt('vi', { ...READY, staleReason: 'runner đổi' })
    expect(stale.find('.nl-chat-nudge').text()).toBe(VI_BEFORE.stale('runner đổi'))
  })

  it('bản `vi` của tin đang gửi và lỗi 409 giống HỆT chuỗi cứng cũ', async () => {
    // Step còn chạy thì echo chưa bị xoá dù transcript đã có câu trả lời của runner.
    const w = await mountAt('vi', { ...READY, running: { jobId: 'j1', stepId: 'design' } })
    await sendText(w, 'sửa phần B')
    expect(w.findAll('.nl-chat-role').map((n) => n.text())).toEqual([
      VI_BEFORE.roleUser,
      VI_BEFORE.roleRunner,
      VI_BEFORE.roleUserPending,
    ])
    expect(statusTexts(w)).toContain(VI_BEFORE.sending)

    const busy = await mountAt('vi', READY, { status: 409, body: { error: 'busy' } })
    await sendText(busy, 'gửi khi step đang chạy')
    expect(busy.find('.nl-chat-error').text()).toBe(VI_BEFORE.stepBusy)
    expect(lastStatus(busy)).toEqual({ kind: 'error', text: VI_BEFORE.error(VI_BEFORE.stepBusy) })
  })

  it('đổi locale thì nhãn vai, hint, placeholder và trạng thái đổi theo', async () => {
    const texts = async (locale: 'vi' | 'en') => {
      const w = await mountAt(locale, { ...READY, staleReason: 'x' })
      const empty = await mountAt(locale, { ...READY, sessionId: '', turns: [], total: 0 })
      return {
        roles: w.findAll('.nl-chat-role').map((n) => n.text()),
        placeholder: w.find('textarea').attributes('placeholder'),
        status: lastStatus(w)?.text,
        stale: w.find('.nl-chat-nudge').text(),
        hint: empty.find('.nl-chat-hint').text(),
      }
    }
    const vi = await texts('vi')
    const en = await texts('en')
    expect(en.roles[0]).not.toBe(vi.roles[0])
    expect(en.placeholder).not.toBe(vi.placeholder)
    expect(en.status).not.toBe(vi.status)
    expect(en.stale).not.toBe(vi.stale)
    expect(en.stale).toContain('(x)')
    expect(en.hint).not.toBe(vi.hint)
  })

  it('🚫 không lộ khoá thô `nlChat.*` ra DOM hay trạng thái ở cả hai locale', async () => {
    const states = [
      { ...READY, staleReason: 'x' },
      { ...READY, sessionId: '', turns: [], total: 0 },
      { ...READY, transcriptFound: false, turns: [], total: 0 },
      { ...READY, turns: [], total: 0 },
      { ...READY, canSend: false, blockedReason: 'noCompletedJob' },
      { ...READY, queued: true, running: { jobId: 'j1', stepId: 'design' } },
    ]
    for (const locale of ['vi', 'en'] as const) {
      for (const state of states) {
        const w = await mountAt(locale, state)
        expect(w.html()).not.toMatch(/nlChat\./)
        expect(statusTexts(w).join('\n')).not.toMatch(/nlChat\./)
      }
      const sent = await mountAt(locale, { ...READY, running: { jobId: 'j1' } })
      await sendText(sent, 'hi')
      expect(sent.html()).not.toMatch(/nlChat\./)
      const busy = await mountAt(locale, READY, { status: 409 })
      await sendText(busy, 'hi')
      expect(busy.html()).not.toMatch(/nlChat\./)
      expect(statusTexts(busy).join('\n')).not.toMatch(/nlChat\./)
    }
  })

  it('chuỗi cứng cũ đã rời khỏi component và composable', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../src/features/nl-chat')
    const sources = ['components/TaskChatBody.vue', 'composables/useTaskChat.ts']
      .map((rel) => readFileSync(path.join(root, rel), 'utf8'))
      .join('\n')
    for (const literal of [
      VI_BEFORE.roleUserPending,
      VI_BEFORE.noSession,
      VI_BEFORE.emptySession,
      VI_BEFORE.inputPlaceholder,
      VI_BEFORE.cannotSend,
      VI_BEFORE.noCompletedJob,
      VI_BEFORE.queued,
      VI_BEFORE.stepBusy,
      VI_BEFORE.sending,
      VI_BEFORE.running,
      'Phiên đã cũ',
      'Không tìm thấy transcript',
    ]) {
      expect(sources).not.toContain(literal)
    }
  })
})
