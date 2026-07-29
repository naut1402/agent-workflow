<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import BuilderChatBody from './BuilderChatBody.vue'
import TaskChatBody from './TaskChatBody.vue'
import type { ChatContext } from '../composables/useChatSurface'

// Shell of the floating chat window: position (docked to the draggable icon),
// header, and one of two bodies —
//   builder → create a Task/Pipeline/Agent by chatting (F0012)
//   task    → chat straight into the CLI session of a pipeline step
// Each body reports its own status up; the shell just renders it.

const props = defineProps<{
  projectId?: string | null
  /** Live position of the floating icon — the window docks above it and follows while dragging. */
  anchor?: { right: number; bottom: number }
  context?: ChatContext
  /** False while the window is hidden (minimized) — a hidden task chat stops polling. */
  visible?: boolean
}>()
const emit = defineEmits<{
  /** Hide the window but keep this context, so reopening resumes it. */
  minimize: []
  /** Hide and forget the context (next open starts the creation assistant). */
  close: []
  /** Switch back to the creation assistant without closing. */
  builder: []
}>()

const context = computed<ChatContext>(() => props.context ?? { mode: 'builder' })

// Task mode identifies itself by the task + step it is scoped to (the badge
// icon carries the "this is a runner chat" meaning, so no prose title).
const title = computed(() => {
  const ctx = context.value
  if (ctx.mode !== 'task') return 'Trợ lý tạo mới'
  const step = ctx.stepLabel || ctx.stepId
  return step ? `${ctx.taskId} · ${step}` : ctx.taskId
})

type Status = { kind: 'idle' | 'busy' | 'done' | 'error'; text: string }
const status = ref<Status>({ kind: 'idle', text: 'Sẵn sàng' })
// A body switch leaves the old body's status on screen otherwise.
watch(context, () => (status.value = { kind: 'idle', text: 'Sẵn sàng' }))

const WINDOW_WIDTH = 340
/** Vertical space taken by the icon itself plus a small gap. */
const ANCHOR_OFFSET = 48
const VIEWPORT_MARGIN = 8

const windowRef = ref<HTMLElement | null>(null)
/** Height assumed before the element is mounted (max-height: 70vh). */
const FALLBACK_HEIGHT_RATIO = 0.7

// The window is anchored to the (draggable) icon rather than pinned to the
// viewport corner, so moving the icon moves the chat with it. Clamped so it
// never leaves the viewport when the icon is dragged to an edge.
const anchorStyle = computed(() => {
  const anchor = props.anchor ?? { right: 24, bottom: 24 }
  const height = windowRef.value?.offsetHeight || window.innerHeight * FALLBACK_HEIGHT_RATIO
  const maxRight = Math.max(VIEWPORT_MARGIN, window.innerWidth - WINDOW_WIDTH - VIEWPORT_MARGIN)
  const maxBottom = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN)
  return {
    right: `${Math.min(Math.max(anchor.right, VIEWPORT_MARGIN), maxRight)}px`,
    bottom: `${Math.min(anchor.bottom + ANCHOR_OFFSET, maxBottom)}px`,
  }
})
</script>

<template>
  <div ref="windowRef" class="nl-chat-window" role="dialog" :aria-label="title" :style="anchorStyle">
    <header class="nl-chat-header">
      <span v-if="context.mode === 'task'" class="nl-chat-badge is-task" aria-hidden="true">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.9"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M20.5 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 20.5 12z" />
          <path d="M8.5 10.5h7M8.5 13.5h4.5" />
        </svg>
      </span>
      <span class="nl-chat-title">{{ title }}</span>

      <!-- Status is icon-only (the old text + coloured dot read as an
           online/offline indicator); the label survives as the tooltip. -->
      <span v-if="status.kind !== 'idle'" class="nl-chat-status" :class="`is-${status.kind}`" :title="status.text">
        <svg
          v-if="status.kind === 'busy'"
          class="nl-chat-spinner"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
        >
          <path d="M12 3a9 9 0 1 0 9 9" />
        </svg>
        <svg
          v-else-if="status.kind === 'done'"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M5 13l4 4L19 7" />
        </svg>
        <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3l9.5 16.5H2.5zM11 9h2v5h-2zm0 6.5h2V18h-2z" />
        </svg>
      </span>

      <button
        v-if="context.mode === 'task'"
        type="button"
        class="nl-chat-icon-btn"
        title="Trợ lý tạo mới"
        aria-label="Trợ lý tạo mới"
        @click="emit('builder')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
        </svg>
      </button>
      <!-- Minimize hides the whole window (keeping this chat), matching what
           clicking the floating icon does — a header-only strip looked broken. -->
      <button
        type="button"
        class="nl-chat-icon-btn"
        title="Thu nhỏ"
        aria-label="Thu nhỏ"
        @click="emit('minimize')"
      >
        —
      </button>
      <button type="button" class="nl-chat-icon-btn" title="Đóng" aria-label="Đóng" @click="emit('close')">×</button>
    </header>

    <div class="nl-chat-body">
      <TaskChatBody
        v-if="context.mode === 'task'"
        :key="`${context.taskId}::${context.stepId ?? ''}`"
        :task-id="context.taskId"
        :step-id="context.stepId"
        :step-label="context.stepLabel"
        :project-id="projectId"
        :active="visible !== false"
        @status="status = $event"
      />
      <BuilderChatBody v-else :project-id="projectId" @status="status = $event" @close="emit('close')" />
    </div>
  </div>
</template>
