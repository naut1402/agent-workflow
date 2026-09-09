<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { ref, computed, watch, nextTick, onUpdated, reactive } from 'vue'
import { parseMarkdown, renderMermaid } from '../../../core/lib/markdownLib'
import { saveArtifact, sendTaskFeedback } from '../scripts/QaPanelApi'
import {
  bindFocusableEditRef,
  useInlineMarkdownEdit,
} from '../composables/useInlineMarkdownEdit'
import { parseQaBlocks, applyAnswer, type QaBlock } from '../composables/useQaQuestions'
import SectionSaveIndicator from './SectionSaveIndicator.vue'
import MarkdownTextEditor from '../../../core/ui/MarkdownTextEditor.vue'

const { t } = useI18nHelpers()

const props = defineProps({
  qa: { type: String, default: '' },
  taskId: { type: String, default: '' },
  projectId: { type: String, default: null },
  stepId: { type: String, default: '' },
})

const emit = defineEmits(['saved'])

const content = ref('')
const loadedMtime = ref<number | null>(null)
const message = ref('')
const viewRoot = ref<HTMLElement | null>(null)

const OTHER_VALUE = '__other__'
/** Per quiz-block choice — keyed by `QaBlock.index`. */
const selections = reactive<Record<number, { choice: string | null; other: string }>>({})
const submitting = ref(false)
const submitError = ref('')

const blocks = computed<QaBlock[]>(() => parseQaBlocks(content.value))
const hasQuizBlocks = computed(() => blocks.value.some((b) => b.choices.length > 0))
function blockHtml(block: QaBlock): string {
  // Strip the machine-readable "**Lựa chọn:**" list from the rendered view —
  // its choices already have dedicated radio UI below.
  const withoutChoices = block.raw.replace(
    /^\*\*Lựa chọn:\*\*[ \t]*\r?\n(?:^-\s*[A-Z]\.\s.+\r?\n?)+/m,
    '',
  )
  return parseMarkdown(withoutChoices)
}

function isBlockAnswered(block: QaBlock): boolean {
  const sel = selections[block.index]
  if (!sel || !sel.choice) return false
  return sel.choice === OTHER_VALUE ? sel.other.trim().length > 0 : true
}

function selectChoice(blockIndex: number, choice: string) {
  const existing = selections[blockIndex]
  if (existing) existing.choice = choice
  else selections[blockIndex] = { choice, other: '' }
}

function setOtherText(blockIndex: number, text: string) {
  const existing = selections[blockIndex]
  if (existing) existing.other = text
  else selections[blockIndex] = { choice: OTHER_VALUE, other: text }
}

const canSubmit = computed(
  () =>
    !submitting.value &&
    hasQuizBlocks.value &&
    blocks.value.filter((b) => b.choices.length > 0).every(isBlockAnswered),
)

async function onSubmit() {
  if (!props.taskId || !canSubmit.value) return
  submitting.value = true
  submitError.value = ''
  try {
    let next = content.value
    const answered: string[] = []
    for (const b of blocks.value) {
      if (!b.choices.length) continue
      const sel = selections[b.index]
      const answerText =
        sel.choice === OTHER_VALUE
          ? sel.other.trim()
          : (b.choices.find((c) => c.label === sel.choice)?.text ?? '')
      next = applyAnswer(next, b.index, answerText)
      answered.push(`${b.questionId ?? `#${b.index}`}: ${answerText}`)
    }
    const saved = await saveArtifact(
      props.taskId,
      'qa.md',
      next,
      props.projectId ?? undefined,
      loadedMtime.value ?? undefined,
    )
    content.value = saved.content
    loadedMtime.value = saved.mtime

    const feedbackMessage = `Đã trả lời Q&A:\n${answered.map((a) => `- ${a}`).join('\n')}\n\nVui lòng đọc lại qa.md đã cập nhật và tiếp tục.`
    await sendTaskFeedback(
      props.taskId,
      feedbackMessage,
      { stepId: props.stepId || undefined },
      props.projectId ?? undefined,
    )
    for (const key of Object.keys(selections)) delete selections[Number(key)]
    emit('saved')
  } catch (e: any) {
    submitError.value =
      e?.status === 409
        ? t('monitor.qa.submitError409')
        : e?.status === 400
          ? t('monitor.qa.submitError400')
          : String(e?.message || e)
  } finally {
    submitting.value = false
  }
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
    submitError.value = ''
    for (const key of Object.keys(selections)) delete selections[Number(key)]
  },
  { immediate: true },
)

async function scheduleMermaid() {
  if (isEditing()) return
  await nextTick()
  await renderMermaid(viewRoot.value)
}

watch([content, editingSection], () => scheduleMermaid())
onUpdated(() => scheduleMermaid())
</script>

<template>
  <section class="qa-panel">
    <div class="qa-head">{{ t('monitor.qa.head') }}</div>
    <div class="qa-hint">
      {{ t('monitor.qa.hintBefore') }}
      <code>.dev-team-agent/tasks/&lt;task-id&gt;/qa.md</code>{{ t('monitor.qa.hintAfter') }}
      <code>Answer:</code> {{ t('monitor.qa.hintThen') }}
      <code>done</code> cho orchestrator.
    </div>
    <p v-if="message" class="art-message">{{ message }}</p>
    <div ref="viewRoot" class="qa-blocks">
      <div v-for="block in blocks" :key="block.index" class="qa-block">
        <template v-if="block.choices.length">
          <div class="md" v-html="blockHtml(block)" />
          <div class="qa-choices">
            <label
              v-for="c in block.choices"
              :key="c.label"
              class="qa-choice"
            >
              <input
                type="radio"
                :name="`qa-choice-${block.index}`"
                :value="c.label"
                :checked="selections[block.index]?.choice === c.label"
                @change="selectChoice(block.index, c.label)"
              />
              <span>{{ c.label }}. {{ c.text }}</span>
            </label>
            <label class="qa-choice">
              <input
                type="radio"
                :name="`qa-choice-${block.index}`"
                :value="OTHER_VALUE"
                :checked="selections[block.index]?.choice === OTHER_VALUE"
                @change="selectChoice(block.index, OTHER_VALUE)"
              />
              <span>{{ t('monitor.qa.other') }}</span>
            </label>
            <textarea
              v-if="selections[block.index]?.choice === OTHER_VALUE"
              class="cfg-textarea qa-other-input"
              rows="2"
              :placeholder="t('monitor.qa.otherPlaceholder')"
              :value="selections[block.index]?.other ?? ''"
              @input="setOtherText(block.index, ($event.target as HTMLTextAreaElement).value)"
            />
          </div>
        </template>
        <template v-else>
          <div class="md-section-wrap">
            <SectionSaveIndicator
              :saving="showSavingIndicator(block.index)"
              :saved="showSavedIndicator(block.index)"
            />
            <div
              v-if="editingSection === block.index"
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
              class="md md-editable"
              v-html="parseMarkdown(block.raw)"
              :title="t('monitor.qa.editTitle')"
              @dblclick.prevent="startEdit(block.index, $event)"
            />
          </div>
        </template>
      </div>
      <div v-if="hasQuizBlocks" class="qa-submit-row">
        <p v-if="submitError" class="art-warning">{{ submitError }}</p>
        <button
          type="button"
          class="btn-primary"
          :disabled="!canSubmit"
          @click="onSubmit"
        >{{ submitting ? t('monitor.qa.submitting') : t('monitor.qa.submit') }}</button>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.qa-panel {
  background: rgba(227,179,65,0.08);
  border: 1px solid var(--waiting);
  border-radius: 12px;
  padding: 16px 18px;
  margin-bottom: 16px;
}
.qa-head { font-weight: 700; color: var(--waiting); margin-bottom: 4px; }
.qa-hint { font-size: 12px; color: var(--muted); margin-bottom: 10px; }
.qa-block + .qa-block { margin-top: 14px; padding-top: 14px; border-top: 1px dashed var(--border); }
.qa-choices { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.qa-choice { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; cursor: pointer; }
.qa-choice input[type='radio'] { margin-top: 2px; }
.qa-other-input { margin-top: 4px; margin-left: 24px; width: calc(100% - 24px); }
.qa-submit-row { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border); }
</style>
