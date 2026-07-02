<script setup lang="ts">
import { ref, computed, watch, nextTick, onUpdated } from 'vue'
import { parseMarkdown, renderMermaid } from '../../../shared/markdown'
import { fetchArtifact, saveArtifact } from '../../../api'

const props = defineProps({
  task: { type: Object, required: true },
  openArtifact: { type: Object, default: null }, // { taskId, name }
  projectId: { type: String, default: null },
})

const content = ref('')
const draftContent = ref('')
const loadedKey = ref<string | null>(null)
const loadedMtime = ref<number | null>(null)
const blockMode = ref(false)
const editMode = ref(false)
const saving = ref(false)
const message = ref('')
const externalChange = ref(false)
const viewRoot = ref<HTMLElement | null>(null)

const html = computed(() => parseMarkdown(content.value || ''))

const blocks = computed(() => {
  if (!content.value) return []
  const sections: { heading: string | null; html: string }[] = []
  const parts = content.value.split(/^(?=##\s)/m)
  for (const part of parts) {
    if (!part.trim()) continue
    const firstLine = part.split('\n')[0]
    const isH2 = firstLine.startsWith('## ')
    sections.push({
      heading: isH2 ? firstLine.replace(/^##\s+/, '') : null,
      html: parseMarkdown(part.trim()),
    })
  }
  return sections
})

const isDirty = computed(() => editMode.value && draftContent.value !== content.value)

async function load(taskId: string, name: string) {
  const key = `${taskId}/${name}`
  loadedKey.value = key
  editMode.value = false
  message.value = ''
  externalChange.value = false
  try {
    const res = await fetchArtifact(taskId, name, props.projectId)
    if (loadedKey.value === key) {
      content.value = res.content
      loadedMtime.value = res.mtime
      draftContent.value = res.content
    }
  } catch {
    if (loadedKey.value === key) content.value = ''
  }
}

function enterEdit() {
  draftContent.value = content.value
  editMode.value = true
  message.value = ''
  externalChange.value = false
}

function cancelEdit() {
  editMode.value = false
  draftContent.value = content.value
  message.value = ''
  externalChange.value = false
}

async function save() {
  if (!props.openArtifact) return
  saving.value = true
  message.value = ''
  try {
    const res = await saveArtifact(
      props.openArtifact.taskId,
      props.openArtifact.name,
      draftContent.value,
      props.projectId ?? undefined,
      loadedMtime.value ?? undefined,
    )
    content.value = res.content
    loadedMtime.value = res.mtime
    draftContent.value = res.content
    editMode.value = false
    externalChange.value = false
    message.value = 'Đã lưu.'
    await scheduleMermaid()
  } catch (e: any) {
    if (e.status === 409 && e.body?.content != null) {
      message.value = 'File đã thay đổi trên disk. Nhấn "Tải lại" để đồng bộ.'
      content.value = e.body.content
      loadedMtime.value = e.body.mtime
      if (editMode.value) draftContent.value = e.body.content
    } else {
      message.value = String(e.message || e)
    }
  } finally {
    saving.value = false
  }
}

function reloadExternal() {
  if (!props.openArtifact) return
  load(props.openArtifact.taskId, props.openArtifact.name)
}

async function scheduleMermaid() {
  if (editMode.value) return
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
      editMode.value = false
    }
  },
  { immediate: true },
)

watch(() => props.openArtifact?.name, () => {
  blockMode.value = false
  editMode.value = false
})

watch(
  () => {
    if (!props.openArtifact) return null
    return props.task.artifacts?.[props.openArtifact.name]?.mtime
  },
  (mtime) => {
    if (!props.openArtifact || !mtime || mtime === loadedMtime.value) return
    if (editMode.value && isDirty.value) {
      externalChange.value = true
      return
    }
    load(props.openArtifact.taskId, props.openArtifact.name)
  },
)

watch([html, blockMode, editMode], () => scheduleMermaid())
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
            v-if="!editMode"
            class="btn-view-toggle"
            @click="enterEdit"
            title="Chỉnh sửa nội dung"
          >✏️ Sửa</button>
          <template v-else>
            <button class="btn-view-toggle active" disabled>Đang sửa</button>
            <button class="btn-view-toggle btn-primary-sm" :disabled="saving || !isDirty" @click="save">
              {{ saving ? 'Đang lưu…' : 'Lưu' }}
            </button>
            <button class="btn-view-toggle" :disabled="saving" @click="cancelEdit">Huỷ</button>
          </template>
          <button
            v-if="blocks.length > 1 && !editMode"
            class="btn-view-toggle"
            :class="{ active: blockMode }"
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

      <textarea
        v-if="editMode"
        v-model="draftContent"
        class="cfg-input art-editor"
        spellcheck="false"
      />

      <div v-else ref="viewRoot">
        <div v-if="blockMode" class="block-list">
          <details
            v-for="(block, i) in blocks"
            :key="i"
            class="block-item"
            :open="i < 3"
            @toggle="onBlockToggle"
          >
            <summary v-if="block.heading">{{ block.heading }}</summary>
            <div class="md block-content" v-html="block.html" />
          </details>
        </div>
        <div v-else class="md" v-html="html" />
      </div>
    </template>
  </div>
</template>
