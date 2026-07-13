<script setup lang="ts">
import { ref, computed, watch, nextTick, onUpdated } from 'vue'
import { useI18n } from 'vue-i18n'
import { parseMarkdown, renderMermaid } from '../../../shared/markdown'
import { saveArtifact } from '../../../api'
import {
  bindFocusableEditRef,
  useInlineMarkdownEdit,
} from '../composables/useInlineMarkdownEdit'
import SectionSaveIndicator from './SectionSaveIndicator.vue'
import MarkdownTextEditor from '../../../shared/ui/MarkdownTextEditor.vue'

const { t } = useI18n()

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
  showSavingIndicator,
  showSavedIndicator,
} = useInlineMarkdownEdit({
  getContent: () => content.value,
  setContent: (v) => { content.value = v },
  onSave: async (nextContent) => {
    if (!props.taskId) {
      message.value = t('monitor.qa.noTask')
      return
    }
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
    emit('saved')
    await scheduleMermaid()
  },
})

const html = computed(() => parseMarkdown(content.value || ''))

const bindEditor = bindFocusableEditRef(editTextarea)

async function handleBlur() {
  try {
    await onBlur()
  } catch (e: any) {
    if (e.status === 409 && e.body?.content != null) {
      content.value = e.body.content
      loadedMtime.value = e.body.mtime
      message.value = t('monitor.qa.reloaded')
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
    <div class="qa-head">{{ t('monitor.qa.head') }}</div>
    <div class="qa-hint">
      {{ t('monitor.qa.hintBefore') }}
      <code>.dev-team-agent/tasks/&lt;task-id&gt;/qa.md</code>{{ t('monitor.qa.hintAfter') }}
      <code>Answer:</code> {{ t('monitor.qa.hintThen') }}
      <code>done</code> cho orchestrator.
    </div>
    <p v-if="message" class="art-message">{{ message }}</p>
    <div class="md-section-wrap">
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
      <div
        v-else
        ref="viewRoot"
        class="md md-editable"
        v-html="html"
        :title="t('monitor.qa.editTitle')"
        @dblclick.prevent="startEdit('full', $event)"
      />
    </div>
  </section>
</template>
