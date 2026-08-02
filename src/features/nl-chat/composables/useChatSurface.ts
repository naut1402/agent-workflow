import { readonly, ref } from 'vue'

/**
 * Module-level state for the single floating chat window, so surfaces far from
 * `App.vue` (a pipeline node's popover) can open it with a context instead of
 * threading events up through Monitor. Two contexts:
 *
 *  - `builder`  — the NL creation flow (Task/Pipeline/Agent draft), F0012.
 *  - `task`     — chat straight into the CLI session of a task's pipeline step.
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

const BUILDER: BuilderChatContext = { mode: 'builder' }

const open = ref(false)
const context = ref<ChatContext>(BUILDER)

export function useChatSurface() {
  function openTaskChat(ctx: Omit<TaskChatContext, 'mode'>): void {
    context.value = { mode: 'task', ...ctx }
    open.value = true
  }

  function openBuilderChat(): void {
    context.value = BUILDER
    open.value = true
  }

  /** The floating icon toggles: same context, just show/hide. */
  function toggle(): void {
    open.value = !open.value
  }

  function close(): void {
    open.value = false
  }

  /** Back to the creation flow without closing the window. */
  function resetToBuilder(): void {
    context.value = BUILDER
  }

  return {
    open,
    context: readonly(context),
    openTaskChat,
    openBuilderChat,
    toggle,
    close,
    resetToBuilder,
  }
}
