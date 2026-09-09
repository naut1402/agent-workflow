import { computed, readonly, ref } from 'vue'

/**
 * Module-level state for the floating chat window, so surfaces far from
 * `App.vue` (a pipeline node's popover) can open it with a context instead of
 * threading events up through Monitor. Two context kinds:
 *
 *  - `builder`  — the NL creation flow (Task/Pipeline/Agent draft), F0012.
 *  - `task`     — chat straight into the CLI session of a task's pipeline step.
 *
 * State is a REGISTRY of sessions rather than one context: opening a step's
 * chat while a builder chat is half-written used to overwrite it, and there was
 * no way back. Now every opened chat stays in the registry (capped at
 * MAX_SESSIONS) and the header arrows walk between them; `ChatWindow` keeps
 * every session's body mounted, so an unsubmitted draft survives the switch.
 */

export interface TaskChatContext {
  mode: 'task'
  taskId: string
  stepId?: string
  stepLabel?: string
}

export interface BuilderChatContext {
  mode: 'builder'
}

export type ChatContext = BuilderChatContext | TaskChatContext

/** Internal shape of a registry entry; consumers read `sessions` structurally. */
interface ChatSessionEntry {
  /** Stable identity: `builder:<n>` | `task:<taskId>::<stepId>`. */
  id: string
  context: ChatContext
}

const BUILDER: BuilderChatContext = { mode: 'builder' }

/** Bodies of hidden sessions stay in the DOM, so the registry is capped. */
export const MAX_SESSIONS = 5

const open = ref(false)
const sessions = ref<ChatSessionEntry[]>([])
const activeId = ref<string | null>(null)
let builderSeq = 0

const activeIndex = computed(() => sessions.value.findIndex((s) => s.id === activeId.value))
const activeSession = computed<ChatSessionEntry | null>(() => sessions.value[activeIndex.value] ?? null)
/** Unchanged public shape: `context` is still the active session's context. */
const context = computed<ChatContext>(() => activeSession.value?.context ?? BUILDER)

function taskKey(ctx: Omit<TaskChatContext, 'mode'>): string {
  return `task:${ctx.taskId}::${ctx.stepId ?? ''}`
}

/** Move the cursor only — switching sessions must never force the window open. */
function select(id: string): void {
  activeId.value = id
}

/** Point at a session AND show it — the "open this chat" intent. */
function activate(id: string): void {
  select(id)
  open.value = true
}

function push(entry: ChatSessionEntry): void {
  // Cap: drop the oldest session that is NOT the one being looked at, and prefer
  // a step chat over a builder one — the builder holds an unsubmitted draft,
  // which is exactly what the registry exists to protect.
  if (sessions.value.length >= MAX_SESSIONS) {
    const droppable = (s: ChatSessionEntry): boolean => s.id !== activeId.value
    const victim =
      sessions.value.find((s) => droppable(s) && s.context.mode === 'task') ??
      sessions.value.find(droppable)
    if (victim) sessions.value = sessions.value.filter((s) => s.id !== victim.id)
  }
  sessions.value = [...sessions.value, entry]
  activate(entry.id)
}

export function useChatSurface() {
  /** Open a step's chat. Same step twice → switch to it, never a duplicate. */
  function openTaskChat(ctx: Omit<TaskChatContext, 'mode'>): void {
    const id = taskKey(ctx)
    const found = sessions.value.find((s) => s.id === id)
    if (found) {
      // stepLabel may have been resolved since; keep the newest labelling.
      found.context = { mode: 'task', ...ctx }
      activate(id)
      return
    }
    push({ id, context: { mode: 'task', ...ctx } })
  }

  /**
   * FAB / "back to the creation assistant": REUSE the existing builder session
   * rather than starting over — this is what fixes the reported bug (a draft
   * typed into the builder was lost after visiting a step's chat).
   */
  function openBuilderChat(): void {
    const existing = sessions.value.find((s) => s.context.mode === 'builder')
    if (existing) {
      activate(existing.id)
      return
    }
    push({ id: `builder:${++builderSeq}`, context: BUILDER })
  }

  /** The + button: always a brand new builder session. */
  function newBuilderChat(): void {
    push({ id: `builder:${++builderSeq}`, context: BUILDER })
  }

  function stepSession(delta: number): void {
    if (sessions.value.length < 2) return
    const n = sessions.value.length
    const next = (activeIndex.value + delta + n) % n // wraps around at both ends
    select(sessions.value[next].id)
  }

  function nextSession(): void {
    stepSession(1)
  }

  function prevSession(): void {
    stepSession(-1)
  }

  /** × — forget a session. Emptying the registry re-seeds a builder one, so the
   *  next open is the creation assistant instead of a blank window.
   *
   *  Only `select`, never `activate`: × hides the window first, and dropping the
   *  session must not bounce it back open. */
  function closeSession(id: string): void {
    const idx = sessions.value.findIndex((s) => s.id === id)
    if (idx < 0) return
    sessions.value = sessions.value.filter((s) => s.id !== id)
    if (sessions.value.length === 0) {
      const seeded: ChatSessionEntry = { id: `builder:${++builderSeq}`, context: BUILDER }
      sessions.value = [seeded]
      select(seeded.id)
      return
    }
    select(sessions.value[Math.max(0, idx - 1)].id)
  }

  /** The floating icon toggles: same sessions, just show/hide. */
  function toggle(): void {
    open.value = !open.value
  }

  function close(): void {
    open.value = false
  }

  return {
    open,
    sessions: readonly(sessions),
    activeId: readonly(activeId),
    activeIndex,
    context,
    openTaskChat,
    openBuilderChat,
    newBuilderChat,
    nextSession,
    prevSession,
    closeSession,
    toggle,
    close,
  }
}
