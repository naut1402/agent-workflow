<script setup lang="ts">
import { ref, computed, watch, nextTick, onUpdated } from 'vue'
import { parseMarkdown, renderMermaid } from '../../../shared/markdown'
import { saveArtifact } from '../../../api'

const props = defineProps({
  qa: { type: String, default: '' },
  taskId: { type: String, default: '' },
  projectId: { type: String, default: null },
})

const emit = defineEmits(['saved'])

const content = ref('')
const draftContent = ref('')
const loadedMtime = ref<number | null>(null)
const editMode = ref(false)
const saving = ref(false)
const message = ref('')
const viewRoot = ref<HTMLElement | null>(null)

const html = computed(() => parseMarkdown(content.value || ''))
const isDirty = computed(() => editMode.value && draftContent.value !== content.value)

watch(
  () => props.qa,
  (v) => {
    content.value = v || ''
    draftContent.value = v || ''
    editMode.value = false
    message.value = ''
  },
  { immediate: true },
)

function enterEdit() {
  draftContent.value = content.value
  editMode.value = true
  message.value = ''
}

function cancelEdit() {
  editMode.value = false
  draftContent.value = content.value
  message.value = ''
}

async function save() {
  if (!props.taskId) return
  saving.value = true
  message.value = ''
  try {
    const res = await saveArtifact(
      props.taskId,
      'qa.md',
      draftContent.value,
      props.projectId ?? undefined,
      loadedMtime.value ?? undefined,
    )
    content.value = res.content
    loadedMtime.value = res.mtime
    draftContent.value = res.content
    editMode.value = false
    message.value = 'Đã lưu qa.md.'
    emit('saved')
    await scheduleMermaid()
  } catch (e: any) {
    if (e.status === 409 && e.body?.content != null) {
      content.value = e.body.content
      loadedMtime.value = e.body.mtime
      draftContent.value = e.body.content
      message.value = 'File đã thay đổi trên disk — nội dung đã được tải lại.'
    } else {
      message.value = String(e.message || e)
    }
  } finally {
    saving.value = false
  }
}

async function scheduleMermaid() {
  if (editMode.value) return
  await nextTick()
  await renderMermaid(viewRoot.value)
}

watch([html, editMode], () => scheduleMermaid())
onUpdated(() => scheduleMermaid())
</script>

<template>
  <section class="qa">
    <div class="qa-head">⚠ Pipeline đang chờ trả lời câu hỏi blocking</div>
    <div class="qa-hint">
      Sửa trực tiếp bên dưới và bấm <strong>Lưu</strong>, hoặc mở
      <code>.dev-team-agent/tasks/&lt;task-id&gt;/qa.md</code>, điền <code>Answer:</code> rồi gõ
      <code>done</code> cho orchestrator.
    </div>
    <div class="qa-toolbar">
      <button v-if="!editMode" class="btn-view-toggle" @click="enterEdit">✏️ Sửa</button>
      <template v-else>
        <button class="btn-view-toggle btn-primary-sm" :disabled="saving || !isDirty" @click="save">
          {{ saving ? 'Đang lưu…' : 'Lưu' }}
        </button>
        <button class="btn-view-toggle" :disabled="saving" @click="cancelEdit">Huỷ</button>
      </template>
    </div>
    <p v-if="message" class="art-message">{{ message }}</p>
    <textarea
      v-if="editMode"
      v-model="draftContent"
      class="cfg-input art-editor"
      spellcheck="false"
    />
    <div v-else ref="viewRoot" class="md" v-html="html" />
  </section>
</template>
