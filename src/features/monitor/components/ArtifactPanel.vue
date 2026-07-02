<script setup lang="ts">
import { ref, computed, watch, nextTick, onUpdated } from 'vue'
import { parseMarkdown, renderMermaid } from '../../../shared/markdown'
import { fetchArtifact, saveArtifact } from '../../../api'
import {
  splitMarkdownSections,
  useInlineMarkdownEdit,
} from '../composables/useInlineMarkdownEdit'
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

function onBlockToggle(ev: Event) {
  const el = ev.target as HTMLDetailsElement
  if (el.open) scheduleMermaid()
}

watch(
  () => props.openArtifact,
  (a) => {
    if (a) load(a.taskId, a.name)
    else {
      content.value = ''
      loadedKey.value = null
      loadedMtime.value = null
      cancelEdit()
    }
  },
  { immediate: true },
)

watch(() => props.openArtifact?.name, () => {
  blockMode.value = false
  cancelEdit()
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
            v-if="blocks.length > 1"
            class="btn-view-toggle"
            :class="{ active: blockMode }"
            :disabled="isEditing()"
            @click="blockMode = !blockMode"
            :title="blockMode ? 'Chuyển sang Full view' : 'Chuyển sang Block view'"
          >{{ blockMode ? '📄 Full' : '🗂 Blocks' }}</button>
        </div>
      </div>

      <p v-if="message" class="art-message">{{ message }}</p>
      <p v-if="externalChange" class="art-warning">
        File đã thay đổi trên disk trong lúc bạn sửa.
        <button type="button" class="btn-link" @click="reloadExternal">Tải lại</button>
      </p>

      <p class="art-edit-hint">Click hoặc double-click vào section để sửa; blur để lưu tự động. <kbd>Esc</kbd> huỷ.</p>

      <div ref="viewRoot">
        <div v-if="blockMode" class="block-list">
          <details
            v-for="(block, i) in blocks"
            :key="i"
            class="block-item md-section-wrap"
            :open="i < 3"
            @toggle="onBlockToggle"
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
              title="Click để sửa section"
              @click="startEdit(i, $event)"
              @dblclick="startEdit(i, $event)"
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
            title="Click để sửa"
            @click="startEdit('full', $event)"
            @dblclick="startEdit('full', $event)"
          />
        </div>
      </div>
    </template>
  </div>
</template>
