<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue'
import ChatWindow from './ChatWindow.vue'

// Floating chat icon, bottom-right by default, draggable — the single UI
// anchor for the NL chat surface shared by Task/Pipeline/Agent creation
// (design.md F0012 quyết định #1). Position persists across reloads.

defineProps<{ projectId?: string | null }>()

const POSITION_KEY = 'dev-dashboard-nlchat-position'
const DEFAULT_POSITION = { right: 24, bottom: 24 }

const open = ref(false)
const position = reactive(loadPosition())

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
  open.value = !open.value
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
    💬
  </button>
  <ChatWindow v-if="open" :project-id="projectId" @close="open = false" />
</template>

<style scoped>
.nl-chat-fab {
  position: fixed;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: none;
  background: var(--color-accent, #3b6fe0);
  color: #fff;
  font-size: 22px;
  cursor: grab;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  z-index: 999;
  touch-action: none;
}
.nl-chat-fab:active {
  cursor: grabbing;
}
</style>
