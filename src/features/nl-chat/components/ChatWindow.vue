<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import BuilderChatBody from './BuilderChatBody.vue'
import TaskChatBody from './TaskChatBody.vue'
import type { ChatContext } from '../composables/useChatSurface'

// Shell of the floating chat window: position (docked to the draggable icon),
// header with status + minimize, and one of two bodies —
//   builder → create a Task/Pipeline/Agent by chatting (F0012)
//   task    → chat straight into the CLI session of a pipeline step
// Each body reports its own status text up; the shell just renders it.

const props = defineProps<{
  projectId?: string | null
  /** Live position of the floating icon — the window docks above it and follows while dragging. */
  anchor?: { right: number; bottom: number }
  context?: ChatContext
}>()
const emit = defineEmits<{ close: [] }>()

const context = computed<ChatContext>(() => props.context ?? { mode: 'builder' })

const title = computed(() =>
  context.value.mode === 'task' ? 'Chat với runner' : 'Trợ lý tạo mới',
)

type Status = { kind: 'idle' | 'busy' | 'done' | 'error'; text: string }
const status = ref<Status>({ kind: 'idle', text: 'Sẵn sàng' })
// A body switch leaves the old body's status on screen otherwise.
watch(context, () => (status.value = { kind: 'idle', text: 'Sẵn sàng' }))

const minimized = ref(false)

function onClose(): void {
  emit('close')
}

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
  <div
    ref="windowRef"
    class="nl-chat-window"
    :class="{ 'is-minimized': minimized }"
    role="dialog"
    :aria-label="title"
    :style="anchorStyle"
  >
    <header class="nl-chat-header">
      <span class="nl-chat-title">{{ title }}</span>
      <span class="nl-chat-status" :class="`is-${status.kind}`">
        <span class="nl-chat-status-dot" aria-hidden="true"></span>
        <span class="nl-chat-status-text">{{ status.text }}</span>
      </span>
      <button
        type="button"
        class="nl-chat-icon-btn"
        :title="minimized ? 'Mở rộng' : 'Thu nhỏ'"
        :aria-expanded="!minimized"
        @click="minimized = !minimized"
      >
        {{ minimized ? '▢' : '—' }}
      </button>
      <button type="button" class="nl-chat-icon-btn" title="Đóng" @click="onClose">×</button>
    </header>

    <div v-show="!minimized" class="nl-chat-body">
      <TaskChatBody
        v-if="context.mode === 'task'"
        :key="`${context.taskId}::${context.stepId ?? ''}`"
        :task-id="context.taskId"
        :step-id="context.stepId"
        :step-label="context.stepLabel"
        :project-id="projectId"
        @status="status = $event"
      />
      <BuilderChatBody v-else :project-id="projectId" @status="status = $event" @close="onClose" />
    </div>
  </div>
</template>
