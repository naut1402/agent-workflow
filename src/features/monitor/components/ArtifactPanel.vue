<script setup lang="ts">
import { ref, computed, watch, nextTick, onUpdated } from 'vue'
import { parseMarkdown, renderMermaid } from '../../../shared/markdown'
import { fetchArtifact, saveArtifact, fetchArtifactActions } from '../../../api'
import {
  splitMarkdownSections,
  useInlineMarkdownEdit,
} from '../composables/useInlineMarkdownEdit'
import { useArtifactAction } from '../composables/useArtifactAction'
import SectionSaveIndicator from './SectionSaveIndicator.vue'

const props = defineProps({
  task: { type: Object, required: true },
  openArtifact: { type: Object, default: null },
  projectId: { type: String, default: null },
})

const content = ref('')
const loadedKey = ref<string | null>(null)
const loadedMtime = ref<number | null>(null)
const blockMode = ref(false)
const openBlocks = ref<Set<number>>(new Set())
const message = ref('')
const externalChange = ref(false)
const viewRoot = ref<HTMLElement | null>(null)

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

// ── Quick actions ────────────────────────────────────────────────────────────
const actions = ref<Array<{ id: string; label: string; agent_ref: string; confirm: boolean }>>([])

const { runningActionId, runningActionFor, error: actionError, run: runAction, clearError } = useArtifactAction({
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
})

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
  } catch {
    actions.value = []
  }
}

async function onActionClick(action: { id: string; label: string; confirm: boolean }) {
  if (!props.openArtifact || isEditing() || runningActionId.value) return
  if (action.confirm && typeof window !== 'undefined' && typeof window.confirm === 'function') {
    if (!window.confirm(`Chạy "${action.label}" trên ${props.openArtifact.name}?`)) return
  }
  await runAction(props.openArtifact.taskId, action.id, props.openArtifact.name)
}

const html = computed(() => parseMarkdown(content.value || ''))

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

function bindTextarea(el: HTMLTextAreaElement | null) {
  editTextarea.value = el
}

async function handleBlur() {
  try {
    await onBlur()
  } catch (e: any) {
    if (e.status === 409 && e.body?.content != null) {
      message.value = 'File đã thay đổi trên disk. Nhấn "Tải lại" để đồng bộ.'
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
    if (a) {
      load(a.taskId, a.name)
      loadActions(a.name)
    } else {
      content.value = ''
      loadedKey.value = null
      loadedMtime.value = null
      actions.value = []
      cancelEdit()
    }
  },
  { immediate: true },
)

watch(() => props.openArtifact?.name, () => {
  blockMode.value = false
  cancelEdit()
})

// Reset về mặc định (3 block đầu mở) mỗi khi content được (nạp) lại — cùng gốc
// dữ liệu với `blocks` computed, nên seed lại khi artifact load xong.
watch(content, () => {
  openBlocks.value = new Set([0, 1, 2])
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

watch([html, blockMode, editingSection], () => scheduleMermaid())
onUpdated(() => scheduleMermaid())
</script>

<template>
  <div class="art-view">
    <div v-if="!openArtifact" class="art-empty">Chọn một tài liệu từ danh sách bên trái.</div>

    <template v-else>
      <div class="art-toolbar">
        <span class="art-title">{{ openArtifact.name }}</span>
        <div class="art-toolbar-actions">
          <button
            v-for="action in actions"
            :key="action.id"
            class="btn-quick-action"
            :disabled="isEditing() || !!runningActionId"
            :title="`Chạy agent ${action.agent_ref}`"
            @click="onActionClick(action)"
          >
            <span v-if="runningHereActionId === action.id" class="qa-spinner">⏳ Đang chạy…</span>
            <span v-else>{{ action.label }}</span>
          </button>
          <button
            v-if="blocks.length > 1"
            class="btn-view-toggle"
            :class="{ active: blockMode }"
            :disabled="isEditing()"
            @click="blockMode = !blockMode"
            :title="blockMode ? 'Chuyển sang Full view' : 'Chuyển sang Block view'"
          >{{ blockMode ? '📄 Full' : '🗂 Blocks' }}</button>
          <button
            v-if="blockMode"
            class="btn-view-toggle"
            :disabled="isEditing()"
            :title="allBlocksOpen ? 'Đóng tất cả block' : 'Mở tất cả block'"
            @click="toggleAllBlocks"
          >{{ allBlocksOpen ? '▲' : '▼' }}</button>
        </div>
      </div>

      <p v-if="actionError" class="art-warning">
        {{ actionError }}
        <button type="button" class="btn-link" @click="clearError">Ẩn</button>
      </p>
      <p v-if="message" class="art-message">{{ message }}</p>
      <p v-if="externalChange" class="art-warning">
        File đã thay đổi trên disk trong lúc bạn sửa.
        <button type="button" class="btn-link" @click="reloadExternal">Tải lại</button>
      </p>

      <p class="art-edit-hint">Double-click vào section để sửa; blur để lưu tự động. <kbd>Esc</kbd> huỷ.</p>

      <div ref="viewRoot">
        <div v-if="blockMode" class="block-list">
          <details
            v-for="(block, i) in blocks"
            :key="i"
            class="block-item md-section-wrap"
            :open="openBlocks.has(i)"
            @toggle="onBlockToggle(i, $event)"
          >
            <SectionSaveIndicator
              :saving="showSavingIndicator(i)"
              :saved="showSavedIndicator(i)"
            />
            <summary v-if="block.heading">{{ block.heading }}</summary>
            <textarea
              v-if="editingSection === i"
              :ref="bindTextarea"
              v-model="sectionDraft"
              class="cfg-input art-editor art-section-editor"
              spellcheck="false"
              @blur="handleBlur"
              @keydown="onKeydown"
            />
            <div
              v-else
              class="md block-content md-editable"
              v-html="block.html"
              title="Double-click để sửa section"
              @dblclick.prevent="startEdit(i, $event)"
            />
          </details>
        </div>

        <div v-else class="md-section-wrap">
          <SectionSaveIndicator
            :saving="showSavingIndicator('full')"
            :saved="showSavedIndicator('full')"
          />
          <textarea
            v-if="editingSection === 'full'"
            :ref="bindTextarea"
            v-model="sectionDraft"
            class="cfg-input art-editor"
            spellcheck="false"
            @blur="handleBlur"
            @keydown="onKeydown"
          />
          <div
            v-else
            class="md md-editable"
            v-html="html"
            title="Double-click để sửa"
            @dblclick.prevent="startEdit('full', $event)"
          />
        </div>
      </div>
    </template>
  </div>
</template>
