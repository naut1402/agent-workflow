<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import BuilderChatBody from './BuilderChatBody.vue'
import TaskChatBody from './TaskChatBody.vue'
import type { ChatContext } from '../composables/useChatSurface'
import { fetchRunners } from '../../runner/scripts/runnerApi'
import { closeTaskChatSession } from '../../monitor/scripts/monitorApi'
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import Icon from '../../../core/ui/Icon.vue'

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
  /** Task mode only: switch to a fresh builder chat, same as clicking the FAB
   * while a task chat is open — the step's own session is left untouched. */
  'new-session': []
}>()

const { t } = useI18nHelpers()
const context = computed<ChatContext>(() => props.context ?? { mode: 'builder' })
const builderRef = ref<InstanceType<typeof BuilderChatBody> | null>(null)
/** Bumps to remount TaskChatBody after closing / starting a new session. */
const taskSessionEpoch = ref(0)

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

interface RunnerInfo {
  id: string
  name: string
  enabled: boolean
}

/** Runner of the step being chatted with (task mode), reported by the body. */
const stepRunner = ref<RunnerInfo | null>(null)
/** Runner a builder job would use — `submitJob` with no runnerId takes the default. */
const defaultRunner = ref<RunnerInfo | null>(null)
const runnerLoaded = ref(false)

// A body switch leaves the old body's status/runner on screen otherwise.
watch(context, () => {
  status.value = { kind: 'idle', text: 'Sẵn sàng' }
  stepRunner.value = null
})

async function loadDefaultRunner(): Promise<void> {
  if (runnerLoaded.value) return
  runnerLoaded.value = true
  try {
    const data = await fetchRunners()
    const runners: any[] = Array.isArray(data?.runners) ? data.runners : []
    const picked =
      runners.find((r) => r?.id === data?.defaultRunnerId) ?? runners.find((r) => r?.enabled !== false)
    if (picked) {
      defaultRunner.value = {
        id: picked.id,
        name: picked.name || picked.id,
        enabled: picked.enabled !== false,
      }
    }
  } catch {
    /* best-effort: the popover just omits the runner row */
  }
}

const infoOpen = ref(false)

function onInfoEnter(): void {
  infoOpen.value = true
  // Only the builder needs a lookup; task mode gets its runner from the body.
  if (context.value.mode !== 'task') void loadDefaultRunner()
}

const activeRunner = computed<RunnerInfo | null>(() =>
  context.value.mode === 'task' ? stepRunner.value : defaultRunner.value,
)

const runnerStatusText = computed(() => {
  const runner = activeRunner.value
  if (!runner) return 'chưa xác định'
  if (!runner.enabled) return 'đã tắt'
  return status.value.kind === 'busy' ? 'đang chạy' : 'sẵn sàng'
})

/** Rows of the info popover: what context this chat is bound to. */
const infoRows = computed(() => {
  const rows: { label: string; value: string }[] = [
    { label: 'Project', value: props.projectId || 'mặc định' },
  ]
  const ctx = context.value
  if (ctx.mode === 'task') {
    rows.push({ label: 'Task', value: ctx.taskId })
    const step = ctx.stepLabel || ctx.stepId
    if (step) rows.push({ label: 'Step', value: step })
  } else {
    rows.push({ label: 'Chế độ', value: 'Tạo mới bằng chat (chưa gắn task)' })
  }
  rows.push({
    label: 'Runner',
    value: activeRunner.value
      ? `${activeRunner.value.name} (${runnerStatusText.value})`
      : runnerStatusText.value,
  })
  return rows
})

const DEFAULT_WIDTH = 340
const DEFAULT_HEIGHT_RATIO = 0.6
const MIN_WIDTH = 260
const MIN_HEIGHT = 220
/** Vertical space taken by the icon itself plus a small gap. */
const ANCHOR_OFFSET = 48
const VIEWPORT_MARGIN = 8
const SIZE_KEY = 'dev-dashboard-nlchat-size'

const windowRef = ref<HTMLElement | null>(null)

/**
 * Resize state. The window is anchored to the (draggable) icon at its
 * right/bottom, so growing it would normally only ever extend up and left —
 * `offset` shifts the anchored edges instead, which is what lets the bottom and
 * right corners drag outward too. Persisted like the icon position.
 */
interface ChatSize {
  width: number
  height: number
  offsetX: number
  offsetY: number
}

function defaultSize(): ChatSize {
  return {
    width: DEFAULT_WIDTH,
    height: Math.round(window.innerHeight * DEFAULT_HEIGHT_RATIO),
    offsetX: 0,
    offsetY: 0,
  }
}

function loadSize(): ChatSize {
  try {
    const raw = localStorage.getItem(SIZE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (typeof parsed?.width === 'number' && typeof parsed?.height === 'number') {
        return {
          width: parsed.width,
          height: parsed.height,
          offsetX: typeof parsed.offsetX === 'number' ? parsed.offsetX : 0,
          offsetY: typeof parsed.offsetY === 'number' ? parsed.offsetY : 0,
        }
      }
    }
  } catch {
    /* ignore — fall back to the default size */
  }
  return defaultSize()
}

const size = reactive(loadSize())

function saveSize(): void {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify({ ...size }))
  } catch {
    /* ignore — best-effort persistence only */
  }
}

type ResizeCorner = 'tl' | 'tr' | 'bl' | 'br'

let resizing: ResizeCorner | null = null
let startX = 0
let startY = 0
let startSize: ChatSize = { ...size }

function onResizeStart(corner: ResizeCorner, e: PointerEvent): void {
  resizing = corner
  startX = e.clientX
  startY = e.clientY
  startSize = { ...size }
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  e.preventDefault()
}

function clampWidth(w: number): number {
  return Math.max(MIN_WIDTH, Math.min(w, window.innerWidth - 2 * VIEWPORT_MARGIN))
}

function clampHeight(h: number): number {
  return Math.max(MIN_HEIGHT, Math.min(h, window.innerHeight - 2 * VIEWPORT_MARGIN))
}

function onResizeMove(e: PointerEvent): void {
  if (!resizing) return
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  // Dragging left/up always grows the window; the right/bottom corners keep
  // their opposite edge still by shifting the anchor offset by the same amount.
  const growLeft = resizing === 'tl' || resizing === 'bl'
  const growUp = resizing === 'tl' || resizing === 'tr'

  const width = clampWidth(startSize.width + (growLeft ? -dx : dx))
  const height = clampHeight(startSize.height + (growUp ? -dy : dy))
  size.width = width
  size.height = height
  size.offsetX = growLeft ? startSize.offsetX : startSize.offsetX - (width - startSize.width)
  size.offsetY = growUp ? startSize.offsetY : startSize.offsetY - (height - startSize.height)
}

function onResizeEnd(): void {
  if (!resizing) return
  resizing = null
  saveSize()
}

onMounted(() => {
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeEnd)
})
onUnmounted(() => {
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeEnd)
})

// The window is anchored to the (draggable) icon rather than pinned to the
// viewport corner, so moving the icon moves the chat with it. Clamped so it
// never leaves the viewport when the icon is dragged to an edge (or when a
// resize pushed an edge past it).
const anchorStyle = computed(() => {
  const anchor = props.anchor ?? { right: 24, bottom: 24 }
  const right = anchor.right + size.offsetX
  const bottom = anchor.bottom + ANCHOR_OFFSET + size.offsetY
  const maxRight = Math.max(VIEWPORT_MARGIN, window.innerWidth - size.width - VIEWPORT_MARGIN)
  const maxBottom = Math.max(VIEWPORT_MARGIN, window.innerHeight - size.height - VIEWPORT_MARGIN)
  return {
    width: `${size.width}px`,
    height: `${size.height}px`,
    right: `${Math.min(Math.max(right, VIEWPORT_MARGIN), maxRight)}px`,
    bottom: `${Math.min(Math.max(bottom, VIEWPORT_MARGIN), maxBottom)}px`,
  }
})

/** End the active chat session (NL scratch or task ledger) — used by × to forget it for good. */
async function dismissActiveSession(): Promise<void> {
  const ctx = context.value
  if (ctx.mode === 'builder') {
    await builderRef.value?.cancel?.()
    return
  }
  try {
    await closeTaskChatSession(ctx.taskId, props.projectId ?? undefined, ctx.stepId)
  } catch {
    /* best-effort — UI still resets */
  }
  taskSessionEpoch.value += 1
}

async function onCloseClick(): Promise<void> {
  await dismissActiveSession()
  emit('close')
}

/**
 * + starts a fresh chat. In task mode this must NOT touch the step's CLI
 * session (that used to close it out from under the step, then reopen the
 * same task/step — effectively overwriting it) — instead it switches to a new
 * builder chat, exactly like clicking the FAB while a task chat is open.
 */
async function onNewSession(): Promise<void> {
  if (context.value.mode !== 'builder') {
    emit('new-session')
    return
  }
  await dismissActiveSession()
  builderRef.value?.reset?.()
}
</script>

<template>
  <div ref="windowRef" class="nl-chat-window" role="dialog" :aria-label="title" :style="anchorStyle">
    <header class="nl-chat-header">
      <span v-if="context.mode === 'task'" class="nl-chat-badge is-task" aria-hidden="true">
        <Icon name="chatBubble" :size="14" />
      </span>
      <span class="nl-chat-title">{{ title }}</span>

      <!-- Info: which project/task/step/runner this chat is bound to. -->
      <span
        class="nl-chat-info"
        @pointerenter="onInfoEnter"
        @pointerleave="infoOpen = false"
        @focusin="onInfoEnter"
        @focusout="infoOpen = false"
      >
        <button type="button" class="nl-chat-icon-btn" title="Thông tin context" aria-label="Thông tin context">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5.5" />
            <path d="M12 7.6v.6" />
          </svg>
        </button>
        <div v-if="infoOpen" class="nl-chat-info-popover" role="tooltip">
          <p v-for="row in infoRows" :key="row.label" class="nl-chat-info-row">
            <span class="nl-chat-info-label">{{ row.label }}</span>
            <span class="nl-chat-info-value">{{ row.value }}</span>
          </p>
        </div>
      </span>

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

      <!-- Minimize hides the whole window (keeping this chat), matching what
           clicking the floating icon does — a header-only strip looked broken. -->
      <button
        type="button"
        class="nl-chat-icon-btn"
        :title="t('nlChat.window.newSession')"
        :aria-label="t('nlChat.window.newSession')"
        @click="onNewSession"
      >
        +
      </button>
      <button
        type="button"
        class="nl-chat-icon-btn"
        :title="t('nlChat.window.minimize')"
        :aria-label="t('nlChat.window.minimize')"
        @click="emit('minimize')"
      >
        —
      </button>
      <button
        type="button"
        class="nl-chat-icon-btn"
        :title="t('nlChat.window.close')"
        :aria-label="t('nlChat.window.close')"
        @click="onCloseClick"
      >×</button>
    </header>

    <div
      v-for="corner in (['tl', 'tr', 'bl', 'br'] as const)"
      :key="corner"
      class="nl-chat-resize"
      :class="`is-${corner}`"
      @pointerdown="onResizeStart(corner, $event)"
    ></div>

    <div class="nl-chat-body">
      <TaskChatBody
        v-if="context.mode === 'task'"
        :key="`${context.taskId}::${context.stepId ?? ''}::${taskSessionEpoch}`"
        :task-id="context.taskId"
        :step-id="context.stepId"
        :step-label="context.stepLabel"
        :project-id="projectId"
        :active="visible !== false"
        @status="status = $event"
        @runner="stepRunner = $event"
      />
      <BuilderChatBody
        v-else
        ref="builderRef"
        :project-id="projectId"
        @status="status = $event"
        @close="emit('close')"
      />
    </div>
  </div>
</template>
