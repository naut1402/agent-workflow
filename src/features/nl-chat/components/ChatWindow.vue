<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import BuilderChatBody from './BuilderChatBody.vue'
import TaskChatBody from './TaskChatBody.vue'
import { useChatSurface, type ChatContext } from '../composables/useChatSurface'
import { fetchRunners } from '../../runner/scripts/runnerApi'
import { closeTaskChatSession } from '../../monitor/scripts/monitorApi'
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import Icon from '../../../frontend/ui/Icon.vue'

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
const { sessions, activeId, activeIndex, nextSession, prevSession } = useChatSurface()
const context = computed<ChatContext>(() => props.context ?? { mode: 'builder' })

const bodyRefs = reactive<Record<string, any>>({})
function bindBody(id: string, el: unknown): void {
  if (el) bodyRefs[id] = el
  else delete bodyRefs[id]
}
const activeBody = computed(() => bodyRefs[activeId.value ?? ''] ?? null)

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

const statuses = reactive<Record<string, Status>>({})
const runners = reactive<Record<string, RunnerInfo | null>>({})
const status = computed<Status>(() => statuses[activeId.value ?? ''] ?? idleStatus())
const stepRunner = computed<RunnerInfo | null>(() => runners[activeId.value ?? ''] ?? null)

watch(
  sessions,
  (list) => {
    const live = new Set(list.map((s) => s.id))
    for (const id of Object.keys(statuses)) if (!live.has(id)) delete statuses[id]
    for (const id of Object.keys(runners)) if (!live.has(id)) delete runners[id]
  },
  { deep: true },
)

const defaultRunner = ref<RunnerInfo | null>(null)
const runnerLoaded = ref(false)

async function loadDefaultRunner(): Promise<void> {
  if (runnerLoaded.value) return
  runnerLoaded.value = true
  try {
    const data = await fetchRunners()
    const runners: any[] = Array.isArray(data?.runners) ? data.runners : []
    // xem docs/architecture/code/nl-chat.md §6
    const picked = runners.find((r) => r?.id === data?.effectiveDefaultRunnerId) ?? null
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

// xem docs/architecture/code/nl-chat.md §6
const infoOpen = ref(false)
const infoPinned = ref(false)
const infoRef = ref<HTMLElement | null>(null)
const infoTriggerRef = ref<HTMLButtonElement | null>(null)
let infoRefocusing = false

function openInfo(): void {
  infoOpen.value = true
  if (context.value.mode !== 'task') void loadDefaultRunner()
}

function closeInfo(): void {
  infoOpen.value = false
  infoPinned.value = false
}

function onInfoEnter(): void {
  if (infoRefocusing) return
  openInfo()
}

function onInfoLeave(): void {
  if (!infoPinned.value) infoOpen.value = false
}

function onInfoToggle(): void {
  if (infoPinned.value) {
    closeInfo()
    return
  }
  infoPinned.value = true
  openInfo()
}

function onInfoDocClick(e: MouseEvent): void {
  if (!infoOpen.value) return
  if (infoRef.value?.contains(e.target as Node)) return
  closeInfo()
}

function onInfoKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !infoOpen.value) return
  closeInfo()
  infoRefocusing = true
  infoTriggerRef.value?.focus()
  infoRefocusing = false
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

const infoRows = computed(() => {
  const rows: { label: string; value: string }[] = []
  if (props.projectId) rows.push({ label: t('nlChat.window.infoProject'), value: props.projectId })
  if (props.shellModeLabel) {
    rows.push({ label: t('nlChat.window.infoShellMode'), value: props.shellModeLabel })
  }
  if (props.shellTaskId) {
    rows.push({ label: t('nlChat.window.infoShellTask'), value: props.shellTaskId })
  }
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
  rows.push({
    label: t('nlChat.window.infoConnection'),
    value: props.connected ? t('nlChat.window.connected') : t('nlChat.window.disconnected'),
  })
  return rows
})

const titleTooltip = computed(() =>
  status.value.kind === 'idle' ? title.value : `${title.value} — ${status.value.text}`,
)

const STATUS_ANNOUNCEMENT: Record<Status['kind'], string> = {
  idle: 'nlChat.window.statusReady',
  busy: 'nlChat.window.statusBusy',
  done: 'nlChat.window.statusDone',
  error: 'nlChat.window.statusError',
}

// xem docs/architecture/code/nl-chat.md §7
const statusAnnouncement = computed(() => t(STATUS_ANNOUNCEMENT[status.value.kind]))

const DEFAULT_WIDTH = 340
const DEFAULT_HEIGHT_RATIO = 0.6
const MIN_WIDTH = 260
const MIN_HEIGHT = 220
const ANCHOR_OFFSET = 48
const VIEWPORT_MARGIN = 8
const SIZE_KEY = 'dev-dashboard-nlchat-size'

const windowRef = ref<HTMLElement | null>(null)

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
  document.addEventListener('click', onInfoDocClick, true)
  document.addEventListener('keydown', onInfoKeydown)
})
onUnmounted(() => {
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeEnd)
  document.removeEventListener('click', onInfoDocClick, true)
  document.removeEventListener('keydown', onInfoKeydown)
})

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
</script>

<template>
  <div
    ref="windowRef"
    class="nl-chat-window"
    role="dialog"
    :aria-label="title"
    :style="anchorStyle"
  >
    <header class="nl-chat-header">
      <span
        ref="infoRef"
        class="nl-chat-info"
        @pointerenter="onInfoEnter"
        @pointerleave="onInfoLeave"
        @focusin="onInfoEnter"
        @focusout="onInfoLeave"
      >
        <button
          ref="infoTriggerRef"
          type="button"
          class="icon-btn icon-btn-inline"
          :title="t('nlChat.window.infoTitle')"
          :aria-label="t('nlChat.window.infoTitle')"
          :aria-expanded="infoOpen"
          @click.stop="onInfoToggle"
        >
          <Icon
            :name="status.kind === 'busy' ? 'spinner' : 'info'"
            :size="14"
            :class="{ 'c-spin': status.kind === 'busy' }"
          />
        </button>
        <div v-if="infoOpen" class="nl-chat-info-popover" role="tooltip">
          <p v-for="row in infoRows" :key="row.label" class="nl-chat-info-row">
            <span class="nl-chat-info-label">{{ row.label }}</span>
            <span class="nl-chat-info-value">{{ row.value }}</span>
          </p>
        </div>
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

      <span class="nl-chat-title" :class="`is-${status.kind}`" :title="titleTooltip">{{
        title
      }}</span>
      <!-- xem docs/architecture/code/nl-chat.md §7 -->
      <span class="nl-chat-sr-only" role="status">{{ statusAnnouncement }}</span>

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
      >
        ×
      </button>
    </header>

    <div
      v-for="corner in ['tl', 'tr', 'bl', 'br'] as const"
      :key="corner"
      class="nl-chat-resize"
      :class="`is-${corner}`"
      @pointerdown="onResizeStart(corner, $event)"
    ></div>

    <div class="nl-chat-body">
      <!-- xem docs/architecture/code/nl-chat.md §6 -->
      <div v-for="s in sessions" v-show="s.id === activeId" :key="s.id" class="nl-chat-session">
        <TaskChatBody
          v-if="s.context.mode === 'task'"
          :ref="(el) => bindBody(s.id, el)"
          :task-id="s.context.taskId"
          :step-id="s.context.stepId"
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
