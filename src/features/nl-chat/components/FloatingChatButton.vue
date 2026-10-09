<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import ChatWindow from './ChatWindow.vue'
import { useChatSurface } from '../composables/useChatSurface'
import Icon from '../../../frontend/ui/Icon.vue'

defineProps<{
  projectId?: string | null
  /** Dashboard polling state + shell context, forwarded to the window header/info. */
  connected?: boolean
  shellModeLabel?: string | null
  shellTaskId?: string | null
}>()

const POSITION_KEY = 'dev-dashboard-nlchat-position'
const DEFAULT_POSITION = { right: 24, bottom: 24 }

const { open, sessions, activeId, context, toggle, close, openBuilderChat, closeSession } =
  useChatSurface()
const position = reactive(loadPosition())

// xem docs/architecture/code/nl-chat.md §6
const everOpened = ref(open.value)
watch(open, (v) => {
  if (v) everOpened.value = true
})

let dragging = false
let dragMoved = false
let startX = 0
let startY = 0
let startRight = 0
let startBottom = 0

function loadPosition(): { right: number; bottom: number } {
  try {
    const raw = localStorage.getItem(POSITION_KEY)
    if (!raw) return { ...DEFAULT_POSITION }
    const parsed = JSON.parse(raw)
    if (typeof parsed?.right === 'number' && typeof parsed?.bottom === 'number') return parsed
  } catch {
    /* ignore — fall back to default */
  }
  return { ...DEFAULT_POSITION }
}

function savePosition(): void {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify({ right: position.right, bottom: position.bottom }))
  } catch {
    /* ignore — best-effort persistence only */
  }
}

function onPointerDown(e: PointerEvent): void {
  dragging = true
  dragMoved = false
  startX = e.clientX
  startY = e.clientY
  startRight = position.right
  startBottom = position.bottom
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
}

function onPointerMove(e: PointerEvent): void {
  if (!dragging) return
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true
  position.right = Math.max(4, startRight - dx)
  position.bottom = Math.max(4, startBottom - dy)
}

function onPointerUp(): void {
  if (!dragging) return
  dragging = false
  if (dragMoved) savePosition()
}

function onClick(): void {
  if (dragMoved) {
    dragMoved = false
    return
  }
  if (open.value && context.value.mode === 'task') {
    openBuilderChat()
    return
  }
  if (!open.value && sessions.value.length === 0) {
    openBuilderChat()
    return
  }
  toggle()
}

function onClose(): void {
  const id = activeId.value
  close()
  if (id) closeSession(id)
}

onMounted(() => {
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
})
onUnmounted(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
})
</script>

<template>
  <button
    type="button"
    class="nl-chat-fab"
    :style="{ right: `${position.right}px`, bottom: `${position.bottom}px` }"
    title="Tạo mới bằng chat"
    :aria-expanded="open"
    aria-haspopup="dialog"
    @pointerdown="onPointerDown"
    @click="onClick"
  >
    <Icon name="chatBubble" :size="26" />
  </button>
  <ChatWindow
    v-if="everOpened"
    v-show="open"
    :project-id="projectId"
    :anchor="position"
    :context="context"
    :visible="open"
    :connected="connected"
    :shell-mode-label="shellModeLabel"
    :shell-task-id="shellTaskId"
    @minimize="close"
    @close="onClose"
  />
</template>

<style scoped>
.nl-chat-fab {
  position: fixed;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  cursor: grab;
  z-index: 999;
  touch-action: none;
}
.nl-chat-fab:hover {
  background: var(--hover-surface);
  color: var(--accent);
}
.nl-chat-fab:active {
  cursor: grabbing;
}
</style>
