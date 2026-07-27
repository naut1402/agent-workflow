<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
import { ref, computed, watch, nextTick, onMounted, onUnmounted, onUpdated, inject } from 'vue'
import { useFullscreen } from '@vueuse/core'
import { parseMarkdown, renderMermaid } from '../../../shared/markdown'
import { fetchArtifact, saveArtifact, fetchArtifactActions, fetchRunners } from '../../../api'
import {
  bindFocusableEditRef,
  splitMarkdownSections,
  useInlineMarkdownEdit,
} from '../composables/useInlineMarkdownEdit'
import { useArtifactAction } from '../composables/useArtifactAction'
import { useArtifactSelectionToolbar } from '../composables/useArtifactSelectionToolbar'
import ArtifactProposalReview from './ArtifactProposalReview.vue'
import QuickActionMenuDropdown from '../../quick-action/components/QuickActionMenuDropdown.vue'
import { splitActionsByMenu } from '../../quick-action/lib/menuTree'
import type { ArtifactMenuNode } from '../../../../shared/schemas/artifactAction'
import { useAppSettings } from '../../../shared/composables/useAppSettings'
import { attachMermaidControls } from '../../../shared/composables/useMermaidControls'
import { resolveArtifactViewMode } from '../../../../shared/schemas/appSettings'
import SectionSaveIndicator from './SectionSaveIndicator.vue'
import MarkdownTextEditor from '../../../shared/ui/MarkdownTextEditor.vue'

const props = defineProps({
  task: { type: Object, required: true },
  openArtifact: { type: Object, default: null },
  projectId: { type: String, default: null },
})

const { settings } = useAppSettings()

// Provided by App.vue — lets the runner gate below send the user to Runner
// mode without bubbling a custom event through Monitor/App.
const navigateToMode = inject<((mode: string) => void) | undefined>('navigateToMode', undefined)

const content = ref('')
const loadedKey = ref<string | null>(null)
const loadedMtime = ref<number | null>(null)
const blockMode = ref(resolveArtifactViewMode(settings.value) === 'block')
const openBlocks = ref<Set<number>>(new Set())
const message = ref('')
const externalChange = ref(false)
const viewRoot = ref<HTMLElement | null>(null)
const fullscreenTarget = ref<HTMLElement | null>(null)
const { toggle: toggleFullscreen } = useFullscreen(fullscreenTarget)

function onToggleMermaidFullscreen(wrapEl: HTMLElement) {
  fullscreenTarget.value = wrapEl
  toggleFullscreen()
}

function applyDefaultViewMode() {
  blockMode.value = resolveArtifactViewMode(settings.value) === 'block'
}

const {
  editingSection,
  sectionDraft,
  saving,
  editTextarea,
  startEdit,
  cancelEdit,
  onBlur,
  onKeydown,
  isEditing,
  showSavingIndicator,
  showSavedIndicator,
} = useInlineMarkdownEdit({
  getContent: () => content.value,
  setContent: (v) => { content.value = v },
  onSave: async (nextContent) => {
    if (!props.openArtifact) return
    message.value = ''
    const res = await saveArtifact(
      props.openArtifact.taskId,
      props.openArtifact.name,
      nextContent,
      props.projectId ?? undefined,
      loadedMtime.value ?? undefined,
    )
    content.value = res.content
    loadedMtime.value = res.mtime
    externalChange.value = false
    await scheduleMermaid()
  },
})

// ── Quick actions (title toolbar + selection toolbar) ───────────────────────
interface QuickActionView {
  id: string
  label: string
  agent_ref: string
  confirm: boolean
  attach_points?: string[]
  runner_id?: string
}

// All actions matching the open artifact by pattern (unfiltered by attach
// point); title/selection lists below split on `attach_points` client-side so
// one fetch covers both toolbars.
const actions = ref<QuickActionView[]>([])
const menus = ref<ArtifactMenuNode[]>([])

const titleActions = computed(() =>
  actions.value.filter((a) => (a.attach_points ?? ['artifact-title']).includes('artifact-title')),
)
const selectionActions = computed(() =>
  actions.value.filter((a) => (a.attach_points ?? []).includes('artifact-selection')),
)

const titleToolbar = computed(() => splitActionsByMenu(titleActions.value, menus.value))
const selectionToolbarMenu = computed(() => splitActionsByMenu(selectionActions.value, menus.value))

// Runner "usable" gate for QuickAction (decision §4.2.1 #8): mirrors the Agent
// Editor Build NL gate — a runner is usable unless explicitly disabled.
const runners = ref<Array<{ id: string; name: string; enabled?: boolean }>>([])
const hasUsableRunner = computed(() => runners.value.some((r) => r.enabled !== false))
const gateError = ref('')

async function loadRunners() {
  try {
    const res = await fetchRunners()
    runners.value = Array.isArray(res?.runners) ? res.runners : []
  } catch {
    runners.value = []
  }
}

function goToRunner() {
  navigateToMode?.('runner')
}

const {
  runningActionId,
  runningActionFor,
  error: actionError,
  run: runAction,
  clearError,
  pendingApproval,
  clearPendingApproval,
} = useArtifactAction({
  getProjectId: () => props.projectId ?? null,
  // Only reload when the job's artifact is still the one on screen — the user
  // may have switched artifacts while the job was polling.
  onReload: (target) => {
    if (
      props.openArtifact &&
      props.openArtifact.taskId === target.taskId &&
      props.openArtifact.name === target.name
    ) {
      reloadExternal()
    }
  },
  // A require_approval job settled against a scratch copy — the diff-review modal
  // opens off `pendingApproval` (set by the composable); nothing extra to do here.
})

// True when the pending-approval job still targets the artifact on screen, so a
// stale review (user switched artifacts mid-run) doesn't pop open.
const showProposalReview = computed(
  () =>
    !!pendingApproval.value &&
    !!props.openArtifact &&
    pendingApproval.value.target.taskId === props.openArtifact.taskId &&
    pendingApproval.value.target.name === props.openArtifact.name,
)

function onProposalApproved() {
  reloadExternal()
  clearPendingApproval()
}
function onProposalDiscarded() {
  clearPendingApproval()
}

// Action running for the artifact currently on screen (null if the in-flight
// job belongs to a different artifact), so the spinner lands on the right button.
const runningHereActionId = computed(() =>
  props.openArtifact
    ? runningActionFor(props.openArtifact.taskId, props.openArtifact.name)
    : null,
)

async function loadActions(name: string) {
  try {
    const res = await fetchArtifactActions(name, props.projectId ?? undefined)
    actions.value = Array.isArray(res.actions) ? res.actions : []
    menus.value = Array.isArray(res.menus) ? res.menus : []
  } catch {
    actions.value = []
    menus.value = []
  }
}

async function onActionClick(action: QuickActionView) {
  if (!props.openArtifact || isEditing() || runningActionId.value) return
  gateError.value = ''
  if (!hasUsableRunner.value) {
    gateError.value = t('monitor.artifact.noRunner')
    return
  }
  if (action.confirm && typeof window !== 'undefined' && typeof window.confirm === 'function') {
    if (!window.confirm(t('monitor.artifact.confirmRun', { label: action.label, name: props.openArtifact.name }))) return
  }
  await runAction(props.openArtifact.taskId, action.id, props.openArtifact.name, {
    runnerId: action.runner_id,
  })
}

async function onMenuActionRun(actionId: string) {
  const action = actions.value.find((a) => a.id === actionId)
  if (action) await onActionClick(action)
}

async function onMenuSelectionRun(actionId: string) {
  const action = actions.value.find((a) => a.id === actionId)
  if (action) await onSelectionActionClick(action)
}

// ── Selection toolbar ────────────────────────────────────────────────────────
const selectionToolbar = useArtifactSelectionToolbar({
  getContainer: () => viewRoot.value,
  isBlocked: () => isEditing() || !props.openArtifact,
  getBlockRanges: () => blockLineRanges.value,
})

const selectionToolbarStyle = computed(() => {
  const r = selectionToolbar.rect.value
  if (!r) return {}
  return {
    top: `${r.top + r.height + 6}px`,
    left: `${r.left}px`,
  }
})

async function onSelectionActionClick(action: QuickActionView) {
  if (!props.openArtifact || isEditing() || runningActionId.value) return
  gateError.value = ''
  if (!hasUsableRunner.value) {
    gateError.value = t('monitor.artifact.noRunner')
    return
  }
  const selectedText = selectionToolbar.text.value
  if (!selectedText) {
    selectionToolbar.hide()
    return
  }
  if (action.confirm && typeof window !== 'undefined' && typeof window.confirm === 'function') {
    if (!window.confirm(t('monitor.artifact.confirmRunSelection', { label: action.label }))) return
  }
  const selectedLines = selectionToolbar.lines.value
  selectionToolbar.hide()
  await runAction(props.openArtifact.taskId, action.id, props.openArtifact.name, {
    runnerId: action.runner_id,
    selectedText,
    selectionStartLine: selectedLines?.start,
    selectionEndLine: selectedLines?.end,
  })
}

onMounted(() => {
  loadRunners()
  selectionToolbar.attach()
})
onUnmounted(() => {
  selectionToolbar.detach()
})

const blocks = computed(() => {
  return splitMarkdownSections(content.value).map((source) => {
    const firstLine = source.split('\n')[0]
    const isH2 = firstLine.startsWith('## ')
    return {
      heading: isH2 ? firstLine.replace(/^##\s+/, '') : null,
      source,
      html: parseMarkdown(source),
    }
  })
})

// 1-indexed start/end line of each block within the raw `content`, used to
// give the selection toolbar a line range for the selected text (see
// useArtifactSelectionToolbar's computeSelectionLines). `splitMarkdownSections`
// slices `content` via a lookahead split (no characters consumed), so each
// block's `source` is a literal, in-order substring of `content` — searching
// sequentially from the previous block's end keeps this correct even if two
// blocks happen to share identical text.
const blockLineRanges = computed(() => {
  const full = content.value
  let searchFrom = 0
  return blocks.value.map((block) => {
    const idx = full.indexOf(block.source, searchFrom)
    const start = idx >= 0 ? idx : searchFrom
    searchFrom = start + block.source.length
    const startLine = full.slice(0, start).split('\n').length
    const lineCount = block.source.split('\n').length
    return { startLine, endLine: startLine + lineCount - 1, source: block.source }
  })
})

const bindEditor = bindFocusableEditRef(editTextarea)

async function handleBlur() {
  try {
    await onBlur()
  } catch (e: any) {
    if (e.status === 409 && e.body?.content != null) {
      message.value = t('monitor.artifact.conflictReload')
      content.value = e.body.content
      loadedMtime.value = e.body.mtime
      cancelEdit()
    } else {
      message.value = String(e.message || e)
    }
  }
}

async function load(taskId: string, name: string) {
  const key = `${taskId}/${name}`
  loadedKey.value = key
  cancelEdit()
  message.value = ''
  externalChange.value = false
  try {
    const res = await fetchArtifact(taskId, name, props.projectId)
    if (loadedKey.value === key) {
      content.value = res.content
      loadedMtime.value = res.mtime
    }
  } catch {
    if (loadedKey.value === key) content.value = ''
  }
}

function reloadExternal() {
  if (!props.openArtifact) return
  load(props.openArtifact.taskId, props.openArtifact.name)
}

async function scheduleMermaid() {
  if (isEditing()) return
  await nextTick()
  await renderMermaid(viewRoot.value)
  attachMermaidControls(viewRoot.value, { onToggleFullscreen: onToggleMermaidFullscreen })
}

function onBlockToggle(i: number, ev: Event) {
  const el = ev.target as HTMLDetailsElement
  if (el.open) {
    openBlocks.value.add(i)
    scheduleMermaid()
  } else {
    openBlocks.value.delete(i)
  }
  openBlocks.value = new Set(openBlocks.value) // force reactivity — cùng pattern TaskList.vue
}

function openAllBlocks() {
  openBlocks.value = new Set(blocks.value.map((_, i) => i))
  scheduleMermaid()
}

function closeAllBlocks() {
  openBlocks.value = new Set()
}

const allBlocksOpen = computed(
  () => blocks.value.length > 0 && openBlocks.value.size === blocks.value.length,
)

function toggleAllBlocks() {
  if (allBlocksOpen.value) {
    closeAllBlocks()
  } else {
    openAllBlocks()
  }
}

watch(
  () => props.openArtifact,
  (a) => {
    clearError()
    clearPendingApproval()
    if (a) {
      load(a.taskId, a.name)
      loadActions(a.name)
    } else {
      content.value = ''
      loadedKey.value = null
      loadedMtime.value = null
      actions.value = []
      menus.value = []
      cancelEdit()
    }
  },
  { immediate: true },
)

watch(
  () =>
    props.openArtifact
      ? `${props.openArtifact.taskId}/${props.openArtifact.name}`
      : null,
  (key, prevKey) => {
    if (key != null && key !== prevKey) {
      applyDefaultViewMode()
      cancelEdit()
    }
  },
)

// Mở toàn bộ block mỗi khi content được (nạp) lại — cùng gốc dữ liệu với
// `blocks` computed, nên seed lại khi artifact load xong.
watch(content, () => {
  openBlocks.value = new Set(blocks.value.map((_, i) => i))
})

watch(
  () => {
    if (!props.openArtifact) return null
    return props.task.artifacts?.[props.openArtifact.name]?.mtime
  },
  (mtime) => {
    if (!props.openArtifact || !mtime || mtime === loadedMtime.value) return
    if (isEditing()) {
      externalChange.value = true
      return
    }
    load(props.openArtifact.taskId, props.openArtifact.name)
  },
)

watch([blocks, blockMode, editingSection], () => scheduleMermaid())
onUpdated(() => scheduleMermaid())
</script>

<template>
  <div class="art-view">
    <div v-if="!openArtifact" class="art-empty">{{ t('monitor.artifact.empty') }}</div>

    <template v-else>
      <div class="art-toolbar">
        <span class="art-title">{{ openArtifact.name }}</span>
        <div class="art-toolbar-actions">
          <QuickActionMenuDropdown
            v-for="root in titleToolbar.tree"
            :key="root.id"
            :node="root"
            :disabled="isEditing() || !!runningActionId"
            :running-action-id="runningHereActionId"
            @run="(id) => onMenuActionRun(id)"
          />
          <button
            v-for="action in titleToolbar.flat"
            :key="action.id"
            type="button"
            class="btn-quick-action"
            :disabled="isEditing() || !!runningActionId"
            :title="t('monitor.artifact.runAgent', { agent: action.agent_ref })"
            :aria-label="action.label"
            @click="onActionClick(action)"
          >
            <span v-if="runningHereActionId === action.id" class="qa-spinner">{{ t('monitor.artifact.running') }}</span>
            <span v-else>{{ action.label }}</span>
          </button>
          <button
            v-if="blocks.length > 1"
            type="button"
            class="icon-btn btn-view-mode"
            :class="{ active: blockMode }"
            :disabled="isEditing()"
            :title="blockMode ? t('monitor.artifact.toFull') : t('monitor.artifact.toBlock')"
            :aria-label="blockMode ? t('monitor.artifact.toFull') : t('monitor.artifact.toBlock')"
            @click="blockMode = !blockMode"
          >
            <!-- full view (document) when in block mode — click switches to full -->
            <svg v-if="blockMode" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <rect x="3" y="2" width="10" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" />
              <path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
            </svg>
            <!-- block view (stacked sections) when in full mode — click switches to blocks -->
            <svg v-else viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <rect x="2.5" y="2.5" width="11" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.4" />
              <rect x="2.5" y="9.5" width="11" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.4" />
            </svg>
          </button>
          <button
            v-if="blockMode"
            type="button"
            class="icon-btn"
            :disabled="isEditing()"
            :title="allBlocksOpen ? t('monitor.artifact.collapseAll') : t('monitor.artifact.expandAll')"
            :aria-label="allBlocksOpen ? t('monitor.artifact.collapseAll') : t('monitor.artifact.expandAll')"
            @click="toggleAllBlocks"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                :d="allBlocksOpen ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4'"
              />
            </svg>
          </button>
        </div>
      </div>

      <p v-if="actionError" class="art-warning">
        {{ actionError }}
        <button type="button" class="btn-link" @click="clearError">{{ t('monitor.artifact.hide') }}</button>
      </p>
      <p v-if="gateError" class="art-warning">
        {{ gateError }}
        <button type="button" class="btn-link" @click="goToRunner">{{ t('monitor.artifact.openRunner') }}</button>
        <button type="button" class="btn-link" @click="gateError = ''">{{ t('monitor.artifact.hide') }}</button>
      </p>
      <p v-if="message" class="art-message">{{ message }}</p>
      <p v-if="externalChange" class="art-warning">
        {{ t('monitor.artifact.externalChanged') }}
        <button type="button" class="btn-link" @click="reloadExternal">{{ t('monitor.artifact.reload') }}</button>
      </p>

      <p class="art-edit-hint">{{ t('monitor.artifact.editHint') }} <kbd>Esc</kbd> {{ t('monitor.artifact.editHintEsc') }}</p>

      <ArtifactProposalReview
        v-if="showProposalReview && pendingApproval"
        :job-id="pendingApproval.jobId"
        :artifact-name="pendingApproval.target.name"
        @approved="onProposalApproved"
        @discarded="onProposalDiscarded"
        @close="clearPendingApproval"
      />

      <Teleport to="body">
        <div
          v-if="selectionToolbar.visible.value && (selectionToolbarMenu.flat.length || selectionToolbarMenu.tree.length)"
          class="selection-toolbar"
          :style="selectionToolbarStyle"
        >
          <QuickActionMenuDropdown
            v-for="root in selectionToolbarMenu.tree"
            :key="`sel-${root.id}`"
            :node="root"
            :disabled="!!runningActionId"
            :running-action-id="runningHereActionId"
            @run="(id) => onMenuSelectionRun(id)"
          />
          <button
            v-for="action in selectionToolbarMenu.flat"
            :key="action.id"
            type="button"
            class="btn-quick-action"
            :disabled="!!runningActionId"
            :title="t('monitor.artifact.runAgent', { agent: action.agent_ref })"
            :aria-label="action.label"
            @mousedown.prevent
            @click="onSelectionActionClick(action)"
          >{{ action.label }}</button>
        </div>
      </Teleport>

      <div ref="viewRoot">
        <div v-if="blockMode" class="block-list">
          <details
            v-for="(block, i) in blocks"
            :key="i"
            class="block-item md-section-wrap"
            :data-block-index="i"
            :open="openBlocks.has(i)"
            @toggle="onBlockToggle(i, $event)"
          >
            <SectionSaveIndicator
              :saving="showSavingIndicator(i)"
              :saved="showSavedIndicator(i)"
            />
            <summary v-if="block.heading">{{ block.heading }}</summary>
            <div
              v-if="editingSection === i"
              class="art-editor art-section-editor"
              @keydown.capture="onKeydown"
            >
              <MarkdownTextEditor
                :ref="bindEditor"
                v-model="sectionDraft"
                height="240px"
                autofocus
                @blur="handleBlur"
              />
            </div>
            <div
              v-else
              class="md block-content md-editable"
              v-html="block.html"
              :title="t('monitor.artifact.editSectionTitle')"
              @dblclick.prevent="startEdit(i, $event)"
            />
          </details>
        </div>

        <div v-else class="md-section-wrap">
          <SectionSaveIndicator
            :saving="showSavingIndicator('full')"
            :saved="showSavedIndicator('full')"
          />
          <div
            v-if="editingSection === 'full'"
            class="art-editor"
            @keydown.capture="onKeydown"
          >
            <MarkdownTextEditor
              :ref="bindEditor"
              v-model="sectionDraft"
              height="320px"
              autofocus
              @blur="handleBlur"
            />
          </div>
          <template v-else>
            <div
              v-for="(block, i) in blocks"
              :key="i"
              class="md md-editable"
              :data-block-index="i"
              v-html="block.html"
              :title="t('monitor.artifact.editTitle')"
              @dblclick.prevent="startEdit('full', $event)"
            />
          </template>
        </div>
      </div>
    </template>
  </div>
</template>
