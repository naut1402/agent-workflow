<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import ChatWindow from './ChatWindow.vue'
import { useChatSurface } from '../composables/useChatSurface'

// Floating chat icon, bottom-right by default, draggable — the single UI
// anchor for the NL chat surface shared by Task/Pipeline/Agent creation
// (design.md F0012 quyết định #1). Position persists across reloads.

defineProps<{ projectId?: string | null }>()

const POSITION_KEY = 'dev-dashboard-nlchat-position'
const DEFAULT_POSITION = { right: 24, bottom: 24 }

// Open state + context live in a module-level composable so a pipeline node's
// popover can open this same window scoped to its step.
const { open, context, toggle, close, resetToBuilder, openBuilderChat } = useChatSurface()
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
  // While a step's chat is open, the FAB means "start a new chat" (its
  // tooltip) rather than hide/show — minimizing already has its own button
  // (—) in the window header for the ẩn-giữ-context case.
  if (open.value && context.value.mode === 'task') {
    openBuilderChat()
    return
  }
  // Show/hide only — the context is preserved, so reopening after a minimize
  // resumes the same runner chat instead of resetting it to the builder. The
  // × button is what forgets the context.
  toggle()
}

/** × — hide and drop the step context, so the next open is the creation flow. */
function onClose(): void {
  close()
  resetToBuilder()
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
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M20.5 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 20.5 12z" />
      <path d="M8.5 10.5h7M8.5 13.5h4.5" />
    </svg>
  </button>
  <ChatWindow
    v-if="everOpened"
    v-show="open"
    :project-id="projectId"
    :anchor="position"
    :context="context"
    :visible="open"
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
