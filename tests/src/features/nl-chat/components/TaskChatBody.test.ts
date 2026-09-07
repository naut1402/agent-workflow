import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountWithI18n } from '../../../helpers/i18n'
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
