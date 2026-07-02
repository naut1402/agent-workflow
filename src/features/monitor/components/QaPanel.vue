<script setup lang="ts">
import { ref, computed, watch, nextTick, onUpdated } from 'vue'
import { parseMarkdown, renderMermaid } from '../../../shared/markdown'
import { saveArtifact } from '../../../api'
import { useInlineMarkdownEdit } from '../composables/useInlineMarkdownEdit'

const props = defineProps({
  qa: { type: String, default: '' },
  taskId: { type: String, default: '' },
  projectId: { type: String, default: null },
})

const emit = defineEmits(['saved'])

const content = ref('')
const loadedMtime = ref<number | null>(null)
const message = ref('')
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
} = useInlineMarkdownEdit({
  getContent: () => content.value,
  setContent: (v) => { content.value = v },
  onSave: async (nextContent) => {
    if (!props.taskId) return
    message.value = ''
    const res = await saveArtifact(
      props.taskId,
      'qa.md',
      nextContent,
      props.projectId ?? undefined,
      loadedMtime.value ?? undefined,
    )
    content.value = res.content
    loadedMtime.value = res.mtime
    message.value = 'Đã lưu qa.md.'
    emit('saved')
    await scheduleMermaid()
  },
})

const html = computed(() => parseMarkdown(content.value || ''))

function bindTextarea(el: HTMLTextAreaElement | null) {
  editTextarea.value = el
}

async function handleBlur() {
  try {
    await onBlur()
  } catch (e: any) {
    if (e.status === 409 && e.body?.content != null) {
      content.value = e.body.content
      loadedMtime.value = e.body.mtime
      message.value = 'File đã thay đổi trên disk — nội dung đã được tải lại.'
      cancelEdit()
    } else {
      message.value = String(e.message || e)
    }
  }
}

watch(
  () => props.qa,
  (v) => {
    content.value = v || ''
    cancelEdit()
    message.value = ''
  },
  { immediate: true },
)

async function scheduleMermaid() {
  if (isEditing()) return
  await nextTick()
  await renderMermaid(viewRoot.value)
}

watch([html, editingSection], () => scheduleMermaid())
onUpdated(() => scheduleMermaid())
</script>

<template>
  <section class="qa">
    <div class="qa-head">⚠ Pipeline đang chờ trả lời câu hỏi blocking</div>
    <div class="qa-hint">
      Click hoặc double-click vào nội dung bên dưới để sửa (blur để lưu), hoặc mở
      <code>.dev-team-agent/tasks/&lt;task-id&gt;/qa.md</code>, điền <code>Answer:</code> rồi gõ
      <code>done</code> cho orchestrator.
    </div>
    <p v-if="saving" class="art-saving-hint">Đang lưu…</p>
    <p v-if="message" class="art-message">{{ message }}</p>
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
      ref="viewRoot"
      class="md md-editable"
      v-html="html"
      title="Click để sửa"
      @click="startEdit('full', $event)"
      @dblclick="startEdit('full', $event)"
    />
  </section>
</template>
