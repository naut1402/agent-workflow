import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_SESSIONS, useChatSurface } from '@/features/nl-chat/composables/useChatSurface'

// The registry is module-level singleton state (a pipeline node opens the same
// window from far away), so each test resets it first. It never truly empties —
// closing the last session re-seeds a builder one — so the reset state is
// "exactly one builder session, window closed".
function drain(): void {
  const { sessions, activeId, closeSession, openBuilderChat, close } = useChatSurface()
  openBuilderChat() // reuses the existing builder session, or seeds one
  const builderId = activeId.value
  for (const s of [...sessions.value]) if (s.id !== builderId) closeSession(s.id)
  close()
}

beforeEach(drain)

describe('useChatSurface — session registry', () => {
  it('opening the same task+step twice reuses one session', () => {
    const { openTaskChat, sessions, activeId } = useChatSurface()
    openTaskChat({ taskId: 'T1', stepId: 'designer' })
    const first = activeId.value
    openTaskChat({ taskId: 'T1', stepId: 'designer', stepLabel: 'Design' })

    expect(sessions.value.filter((s) => s.id === first)).toHaveLength(1)
    expect(activeId.value).toBe(first)
    // The freshest labelling wins so the header title stays accurate.
    expect(sessions.value.find((s) => s.id === first)?.context).toMatchObject({
      mode: 'task',
      stepLabel: 'Design',
    })
  })

  it('different steps of the same task are different sessions', () => {
    const { openTaskChat, sessions } = useChatSurface()
    openTaskChat({ taskId: 'T1', stepId: 'designer' })
    openTaskChat({ taskId: 'T1', stepId: 'implementer' })
    expect(sessions.value.filter((s) => s.context.mode === 'task')).toHaveLength(2)
  })

  it('going back to the builder RESUMES the earlier builder session (the reported bug)', () => {
    const { openBuilderChat, openTaskChat, sessions, activeId } = useChatSurface()
    openBuilderChat()
    const builderId = activeId.value

    openTaskChat({ taskId: 'T9', stepId: 'qa' })
    expect(activeId.value).not.toBe(builderId)

    openBuilderChat()
    expect(activeId.value).toBe(builderId)
    // Same entry, not a second builder — that is what keeps the unsent draft.
    expect(sessions.value.filter((s) => s.context.mode === 'builder')).toHaveLength(1)
  })

  it('the + button always starts an additional builder session', () => {
    const { openBuilderChat, newBuilderChat, sessions, activeId } = useChatSurface()
    openBuilderChat()
    const first = activeId.value
    newBuilderChat()

    expect(activeId.value).not.toBe(first)
    expect(sessions.value.filter((s) => s.context.mode === 'builder')).toHaveLength(2)
  })

  it('next/prev walk the sessions and wrap around at both ends', () => {
    const { openBuilderChat, openTaskChat, nextSession, prevSession, sessions, activeId } =
      useChatSurface()
    openBuilderChat()
    openTaskChat({ taskId: 'A' })
    openTaskChat({ taskId: 'B' })
    const ids = sessions.value.map((s) => s.id)
    expect(activeId.value).toBe(ids[2])

    nextSession() // past the end → first
    expect(activeId.value).toBe(ids[0])
    prevSession() // before the start → last
    expect(activeId.value).toBe(ids[2])
    prevSession()
    expect(activeId.value).toBe(ids[1])
  })

  it('a single session makes the arrows a no-op', () => {
    const { openBuilderChat, nextSession, activeId } = useChatSurface()
    openBuilderChat()
    const only = activeId.value
    nextSession()
    expect(activeId.value).toBe(only)
  })

  it('past the cap it drops the oldest step chat and keeps the builder draft', () => {
    const { openBuilderChat, openTaskChat, sessions } = useChatSurface()
    openBuilderChat()
    const builderId = sessions.value[0].id
    for (let i = 0; i < MAX_SESSIONS; i += 1) openTaskChat({ taskId: `T${i}` })

    expect(sessions.value).toHaveLength(MAX_SESSIONS)
    // The builder holds the unsubmitted draft this whole registry exists for, so
    // the victim is the oldest step chat instead.
    expect(sessions.value.some((s) => s.id === builderId)).toBe(true)
    expect(sessions.value.some((s) => s.id === 'task:T0::')).toBe(false)
  })

  it('closing a session activates its neighbour', () => {
    const { openTaskChat, closeSession, sessions, activeId } = useChatSurface()
    openTaskChat({ taskId: 'A' })
    const a = activeId.value!
    openTaskChat({ taskId: 'B' })
    const b = activeId.value!

    closeSession(b)
    expect(activeId.value).toBe(a)
    expect(sessions.value.some((s) => s.id === b)).toBe(false)
  })

  it('closing the last session re-seeds a builder one, so the next open is not blank', () => {
    const { openTaskChat, closeSession, sessions, activeId } = useChatSurface()
    // Down to a single task session…
    while (sessions.value.length > 1) closeSession(sessions.value[0].id)
    openTaskChat({ taskId: 'Z' })
    while (sessions.value.length > 1) closeSession(sessions.value[0].id)
    expect(sessions.value[0].context).toMatchObject({ mode: 'task', taskId: 'Z' })

    // …and closing it never empties the registry: a builder session takes over.
    closeSession(sessions.value[0].id)
    expect(sessions.value).toHaveLength(1)
    expect(sessions.value[0].context.mode).toBe('builder')
    expect(activeId.value).toBe(sessions.value[0].id)
  })

  it('closing an unknown id changes nothing', () => {
    const { openBuilderChat, closeSession, sessions, activeId } = useChatSurface()
    openBuilderChat()
    const before = { count: sessions.value.length, active: activeId.value }
    closeSession('task:nope::nope')
    expect(sessions.value.length).toBe(before.count)
    expect(activeId.value).toBe(before.active)
  })

  it('`context` tracks the active session and falls back to builder when empty', () => {
    const { openTaskChat, openBuilderChat, context } = useChatSurface()
    openBuilderChat()
    expect(context.value.mode).toBe('builder')
    openTaskChat({ taskId: 'T7', stepId: 'reviewer' })
    expect(context.value).toMatchObject({ mode: 'task', taskId: 'T7', stepId: 'reviewer' })
  })

  it('opening any session also opens the window', () => {
    const { open, close, openTaskChat } = useChatSurface()
    close()
    expect(open.value).toBe(false)
    openTaskChat({ taskId: 'T3' })
    expect(open.value).toBe(true)
  })

  // The × button hides the window and THEN drops the session. If dropping it
  // re-opened the window, × would look broken: the draft is gone but the window
  // is still there, now pointing at some other chat.
  it('closing the last session does not reopen the window', () => {
    const { open, close, openBuilderChat, activeId, closeSession } = useChatSurface()
    openBuilderChat()
    const only = activeId.value!
    close()
    closeSession(only)
    expect(open.value).toBe(false)
  })

  it('closing one of several sessions does not reopen the window', () => {
    const { open, close, openBuilderChat, openTaskChat, activeId, closeSession } = useChatSurface()
    openBuilderChat()
    openTaskChat({ taskId: 'T1', stepId: 's' })
    const current = activeId.value!
    close()
    closeSession(current)
    expect(open.value).toBe(false)
  })

  it('walking sessions with the arrows does not reopen a hidden window', () => {
    const { open, close, openBuilderChat, openTaskChat, nextSession } = useChatSurface()
    openBuilderChat()
    openTaskChat({ taskId: 'T2' })
    close()
    nextSession()
    expect(open.value).toBe(false)
  })
})
