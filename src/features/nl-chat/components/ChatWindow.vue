<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import BuilderChatBody from './BuilderChatBody.vue'
import TaskChatBody from './TaskChatBody.vue'
import { useChatSurface, type ChatContext } from '../composables/useChatSurface'
import { fetchRunners } from '../../runner/scripts/runnerApi'
import { closeTaskChatSession } from '../../monitor/scripts/monitorApi'
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import Icon from '../../../core/ui/Icon.vue'

// Shell of the floating chat window: position (docked to the draggable icon),
// header, and the bodies of every open session —
//   builder → create a Task/Pipeline/Agent by chatting (F0012)
//   task    → chat straight into the CLI session of a pipeline step
// Every session's body stays mounted and only the active one is shown, so a
// half-written builder draft survives a detour into a step's chat. Each body
// reports its own status up; the shell just renders the active one's.

const props = defineProps<{
  projectId?: string | null
  /** Live position of the floating icon — the window docks above it and follows while dragging. */
  anchor?: { right: number; bottom: number }
  context?: ChatContext
  /** False while the window is hidden (minimized) — a hidden task chat stops polling. */
  visible?: boolean
  /** Dashboard's polling connection state — the header badge mirrors the sidebar dot. */
  connected?: boolean
  /** Shell's active mode label / selected task, for the info popover. Null → row hidden. */
  shellModeLabel?: string | null
  shellTaskId?: string | null
}>()
const emit = defineEmits<{
  /** Hide the window but keep this context, so reopening resumes it. */
  minimize: []
  /** Hide and drop the active session. */
  close: []
}>()

const { t } = useI18nHelpers()
const { sessions, activeId, activeIndex, newBuilderChat, nextSession, prevSession } =
  useChatSurface()
const context = computed<ChatContext>(() => props.context ?? { mode: 'builder' })

/** Body instances by session id — × needs the ACTIVE one to end its session. */
const bodyRefs = reactive<Record<string, any>>({})
function bindBody(id: string, el: unknown): void {
  if (el) bodyRefs[id] = el
  else delete bodyRefs[id]
}
const activeBody = computed(() => bodyRefs[activeId.value ?? ''] ?? null)

// Task mode identifies itself by the task + step it is scoped to (the badge
// carries the connection meaning, so no prose title).
const title = computed(() => {
  const ctx = context.value
  if (ctx.mode !== 'task') return t('nlChat.window.builderTitle')
  const step = ctx.stepLabel || ctx.stepId
  return step ? `${ctx.taskId} · ${step}` : ctx.taskId
})

type Status = { kind: 'idle' | 'busy' | 'done' | 'error'; text: string }
const idleStatus = (): Status => ({ kind: 'idle', text: t('nlChat.window.statusReady') })

interface RunnerInfo {
  id: string
  name: string
  enabled: boolean
}

// Status/runner are per session: switching sessions reads another key instead
// of leaving the previous body's state on screen.
const statuses = reactive<Record<string, Status>>({})
const runners = reactive<Record<string, RunnerInfo | null>>({})
const status = computed<Status>(() => statuses[activeId.value ?? ''] ?? idleStatus())
const stepRunner = computed<RunnerInfo | null>(() => runners[activeId.value ?? ''] ?? null)

// Drop the entries of sessions that left the registry, so the maps do not grow
// with every chat ever opened.
watch(
  sessions,
  (list) => {
    const live = new Set(list.map((s) => s.id))
    for (const id of Object.keys(statuses)) if (!live.has(id)) delete statuses[id]
    for (const id of Object.keys(runners)) if (!live.has(id)) delete runners[id]
  },
  { deep: true },
)

/** Runner a builder job would use — `submitJob` with no runnerId takes the default. */
const defaultRunner = ref<RunnerInfo | null>(null)
const runnerLoaded = ref(false)

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
  if (!runner) return ''
  if (!runner.enabled) return t('nlChat.window.runnerDisabled')
  return status.value.kind === 'busy'
    ? t('nlChat.window.runnerRunning')
    : t('nlChat.window.runnerReady')
})

/**
 * Rows of the info popover: what context this chat is bound to. Rows are pushed
 * conditionally — an unknown value hides its row instead of showing a
 * placeholder next to a label.
 */
const infoRows = computed(() => {
  const rows: { label: string; value: string }[] = []
  if (props.projectId) rows.push({ label: t('nlChat.window.infoProject'), value: props.projectId })
  // Dashboard context: the mode and task currently selected in the shell.
  if (props.shellModeLabel) {
    rows.push({ label: t('nlChat.window.infoShellMode'), value: props.shellModeLabel })
  }
  if (props.shellTaskId) {
    rows.push({ label: t('nlChat.window.infoShellTask'), value: props.shellTaskId })
  }
  // This chat's own context.
  const ctx = context.value
  if (ctx.mode === 'task') {
    rows.push({ label: t('nlChat.window.infoTask'), value: ctx.taskId })
    const step = ctx.stepLabel || ctx.stepId
    if (step) rows.push({ label: t('nlChat.window.infoStep'), value: step })
  } else {
    rows.push({
      label: t('nlChat.window.infoChatMode'),
      value: t('nlChat.window.chatModeBuilder'),
    })
  }
  if (activeRunner.value) {
    rows.push({
      label: t('nlChat.window.infoRunner'),
      value: `${activeRunner.value.name} (${runnerStatusText.value})`,
    })
  }
  return rows
})

/** The badge shows the busy spinner while a step's job runs, the connection dot otherwise. */
const badgeTitle = computed(() => {
  if (status.value.kind === 'busy') return status.value.text
  return props.connected ? t('nlChat.window.connected') : t('nlChat.window.disconnected')
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
    await activeBody.value?.cancel?.()
    return
  }
  try {
    await closeTaskChatSession(ctx.taskId, props.projectId ?? undefined, ctx.stepId)
  } catch {
    /* best-effort — UI still resets */
  }
}

async function onCloseClick(): Promise<void> {
  await dismissActiveSession()
  emit('close')
}

/**
 * + starts a fresh chat. It must NOT touch the current session — in task mode
 * that used to close the step's CLI session out from under it. A new builder
 * session is simply pushed on top; the arrows walk back.
 */
function onNewSession(): void {
  newBuilderChat()
}
</script>

<template>
  <div ref="windowRef" class="nl-chat-window" role="dialog" :aria-label="title" :style="anchorStyle">
    <header class="nl-chat-header">
      <!-- Connection dot by default (same dot as the dashboard sidebar); while a
           step's job runs, the busy spinner takes this spot instead. -->
      <span class="nl-chat-badge" role="img" :aria-label="badgeTitle" :title="badgeTitle">
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
        <span v-else class="dot" :class="{ live: connected }" aria-hidden="true"></span>
      </span>

      <button
        v-if="sessions.length > 1"
        type="button"
        class="icon-btn icon-btn-inline"
        :title="t('nlChat.window.prevSession')"
        :aria-label="t('nlChat.window.prevSession')"
        @click="prevSession"
      >
        <Icon name="chevronLeft" :size="14" />
      </button>

      <span class="nl-chat-title">{{ title }}</span>

      <template v-if="sessions.length > 1">
        <span class="nl-chat-session-counter">{{ activeIndex + 1 }}/{{ sessions.length }}</span>
        <button
          type="button"
          class="icon-btn icon-btn-inline"
          :title="t('nlChat.window.nextSession')"
          :aria-label="t('nlChat.window.nextSession')"
          @click="nextSession"
        >
          <Icon name="chevronRight" :size="14" />
        </button>
      </template>

      <!-- Info: which project/mode/task/step/runner this chat is bound to. -->
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

      <!-- Terminal outcomes only: the busy spinner moved to the badge. -->
      <span
        v-if="status.kind === 'done' || status.kind === 'error'"
        class="nl-chat-status"
        :class="`is-${status.kind}`"
        :title="status.text"
      >
        <svg
          v-if="status.kind === 'done'"
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
      <!-- Every session stays mounted; only the active one is shown. `v-show`
           sits on this wrapper because BuilderChatBody's root is a fragment. -->
      <div v-for="s in sessions" v-show="s.id === activeId" :key="s.id" class="nl-chat-session">
        <TaskChatBody
          v-if="s.context.mode === 'task'"
          :ref="(el) => bindBody(s.id, el)"
          :task-id="s.context.taskId"
          :step-id="s.context.stepId"
          :step-label="s.context.stepLabel"
          :project-id="projectId"
          :active="s.id === activeId && visible !== false"
          @status="statuses[s.id] = $event"
          @runner="runners[s.id] = $event"
        />
        <BuilderChatBody
          v-else
          :ref="(el) => bindBody(s.id, el)"
          :project-id="projectId"
          @status="statuses[s.id] = $event"
          @close="emit('close')"
        />
      </div>
    </div>
  </div>
</template>
