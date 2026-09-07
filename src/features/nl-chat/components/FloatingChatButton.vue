<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import ChatWindow from './ChatWindow.vue'
import { useChatSurface } from '../composables/useChatSurface'
import Icon from '../../../core/ui/Icon.vue'

// Floating chat icon, bottom-right by default, draggable — the single UI
// anchor for the NL chat surface shared by Task/Pipeline/Agent creation
// (design.md F0012 quyết định #1). Position persists across reloads.

defineProps<{
  projectId?: string | null
  /** Dashboard polling state + shell context, forwarded to the window header/info. */
  connected?: boolean
  shellModeLabel?: string | null
  shellTaskId?: string | null
}>()

const POSITION_KEY = 'dev-dashboard-nlchat-position'
const DEFAULT_POSITION = { right: 24, bottom: 24 }

// Open state + the session registry live in a module-level composable so a
// pipeline node's popover can open this same window scoped to its step.
const { open, sessions, activeId, context, toggle, close, openBuilderChat, closeSession } =
  useChatSurface()
const position = reactive(loadPosition())

// Once opened, the window stays mounted and is only hidden — minimizing must
// not throw away an in-progress creation chat (its messages live in the body's
// composable). `open` is forwarded so a hidden task chat stops polling.
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
  // While a step's chat is open, the FAB means "back to the creation assistant"
  // rather than hide/show — and thanks to the registry that RESUMES the earlier
  // builder session (with whatever was typed into it) instead of starting over.
  // Minimizing has its own button (—) in the header for the ẩn-giữ-context case.
  if (open.value && context.value.mode === 'task') {
    openBuilderChat()
    return
  }
  // Nothing opened yet → seed the builder session.
  if (!open.value && sessions.value.length === 0) {
    openBuilderChat()
    return
  }
  // Show/hide only — sessions are preserved, so reopening after a minimize
  // resumes the same chat. The × button is what forgets one.
  toggle()
}

/** × — hide and drop the active session; an emptied registry re-seeds a builder one. */
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
/* No filled background per UI review — a bare, draggable glyph that inherits
   the theme's text color instead of a blue circle. */
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
