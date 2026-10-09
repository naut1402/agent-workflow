import { computed, readonly, ref } from 'vue'

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

interface ChatSessionEntry {
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
const context = computed<ChatContext>(() => activeSession.value?.context ?? BUILDER)

function taskKey(ctx: Omit<TaskChatContext, 'mode'>): string {
  return `task:${ctx.taskId}::${ctx.stepId ?? ''}`
}

function select(id: string): void {
  activeId.value = id
}

function activate(id: string): void {
  select(id)
  open.value = true
}

function push(entry: ChatSessionEntry): void {
  // xem docs/architecture/code/nl-chat.md §6
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
  function openTaskChat(ctx: Omit<TaskChatContext, 'mode'>): void {
    const id = taskKey(ctx)
    const found = sessions.value.find((s) => s.id === id)
    if (found) {
      found.context = { mode: 'task', ...ctx }
      activate(id)
      return
    }
    push({ id, context: { mode: 'task', ...ctx } })
  }

  function openBuilderChat(): void {
    const existing = sessions.value.find((s) => s.context.mode === 'builder')
    if (existing) {
      activate(existing.id)
      return
    }
    push({ id: `builder:${++builderSeq}`, context: BUILDER })
  }

  function newBuilderChat(): void {
    push({ id: `builder:${++builderSeq}`, context: BUILDER })
  }

  function stepSession(delta: number): void {
    if (sessions.value.length < 2) return
    const n = sessions.value.length
    const next = (activeIndex.value + delta + n) % n
    select(sessions.value[next].id)
  }

  function nextSession(): void {
    stepSession(1)
  }

  function prevSession(): void {
    stepSession(-1)
  }

  // xem docs/architecture/code/nl-chat.md §6
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
